export interface User {
  id: number;
  displayName: string;
  email: string;
  googleID?: string;
  photoURL?: string;
  activeFlag?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}