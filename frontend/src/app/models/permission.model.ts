export interface Permission {
    id: number;
    resource: string;
    action: string;
    description?: string;
}

export interface UserGroup {
    id: number;
    name: string;
    description?: string;
    activeFlag?: boolean;
    memberCount?: number;
    members?: { id: number; displayName: string; email: string }[];
    permissions?: Permission[];
}

export interface AdminUser {
    id: number;
    displayName: string;
    email: string;
    photoURL?: string;
    activeFlag?: boolean;
    groups?: { id: number; name: string }[];
    directPermissions?: Permission[];
}
