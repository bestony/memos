import { create } from "zustand";
import { combine } from "zustand/middleware";
import { authServiceClient, userServiceClient } from "@/grpcweb";
import { User, UserSetting } from "@/types/proto/api/v2/user_service";
import { UserNamePrefix, extractUsernameFromName } from "./resourceName";

interface State {
  userMapByUsername: Record<string, User>;
  currentUser?: User;
  userSetting?: UserSetting;
}

const getDefaultState = (): State => ({
  userMapByUsername: {},
  currentUser: undefined,
  userSetting: undefined,
});

const getDefaultUserSetting = () => {
  return UserSetting.fromPartial({
    locale: "en",
    appearance: "auto",
    memoVisibility: "PRIVATE",
  });
};

// Request cache is used to prevent multiple requests.
const requestCache = new Map<string, Promise<any>>();

export const useUserStore = create(
  combine(getDefaultState(), (set, get) => ({
    fetchUsers: async () => {
      const { users } = await userServiceClient.listUsers({});
      const userMap = get().userMapByUsername;
      for (const user of users) {
        const username = extractUsernameFromName(user.name);
        userMap[username] = user;
      }
      set({ userMapByUsername: userMap });
      return users;
    },
    getOrFetchUserByUsername: async (username: string) => {
      const userMap = get().userMapByUsername;
      if (userMap[username]) {
        return userMap[username] as User;
      }
      if (requestCache.has(username)) {
        return await requestCache.get(username);
      }

      const promisedUser = userServiceClient
        .getUser({
          name: `${UserNamePrefix}${username}`,
        })
        .then(({ user }) => user);
      requestCache.set(username, promisedUser);
      const user = await promisedUser;
      if (!user) {
        throw new Error("User not found");
      }
      requestCache.delete(username);
      userMap[username] = user;
      set({ userMapByUsername: userMap });
      return user;
    },
    getUserByUsername: (username: string) => {
      const userMap = get().userMapByUsername;
      return userMap[username];
    },
    updateUser: async (user: Partial<User>, updateMask: string[]) => {
      const { user: updatedUser } = await userServiceClient.updateUser({
        user: user,
        updateMask: updateMask,
      });
      if (!updatedUser) {
        throw new Error("User not found");
      }
      const username = extractUsernameFromName(updatedUser.name);
      const userMap = get().userMapByUsername;
      userMap[username] = updatedUser;
      set({ userMapByUsername: userMap });
      return updatedUser;
    },
    deleteUser: async (name: string) => {
      await userServiceClient.deleteUser({
        name,
      });
    },
    fetchCurrentUser: async () => {
      const { user } = await authServiceClient.getAuthStatus({});
      if (!user) {
        throw new Error("User not found");
      }
      set({ currentUser: user });
      const { setting } = await userServiceClient.getUserSetting({});
      set({
        userSetting: UserSetting.fromPartial({
          ...getDefaultUserSetting(),
          ...setting,
        }),
      });
      return user;
    },
    setCurrentUser: (user: User) => {
      set({ currentUser: user });
    },
    updateUserSetting: async (userSetting: Partial<UserSetting>, updateMask: string[]) => {
      const { setting: updatedUserSetting } = await userServiceClient.updateUserSetting({
        setting: userSetting,
        updateMask: updateMask,
      });
      if (!updatedUserSetting) {
        throw new Error("User setting not found");
      }
      set({ userSetting: updatedUserSetting });
      return updatedUserSetting;
    },
  }))
);
