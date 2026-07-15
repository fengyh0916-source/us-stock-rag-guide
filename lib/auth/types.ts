export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  isAdmin?: boolean;
};

export type AuthSession = {
  user: PublicUser;
};

export type LoginReason = "agent" | "asset-tracker" | "general";
