export interface Task {
    id: number;
    projectID: number;
    taskListID: number;
    ownerUserID: number;
    name: string;
    description?: string;
    doneFlag: boolean;
    completeWithChildren: boolean;
    dueDate?: Date;
    timeEstimate?: number;
    taskTypeEnum: TaskType;
    activeFlag: boolean;
    createdAt: Date;
    updatedAt: Date;
    owner?: {
        id: number;
        displayName: string;
        email: string;
        photoURL: string;
    };
}

export interface TaskList {
    id: number;
    name: string;
    activeFlag: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export enum TaskType {
    NORMAL = 'normal',
    TRACKING = 'tracking',
    CRITICAL_PATH = 'critical_path'
}

// These enums are kept for the frontend UI but are not part of the backend model
export enum TaskPriority {
    LOW = 'Low',
    MEDIUM = 'Medium',
    HIGH = 'High'
}

export enum TaskStatus {
    ACTIVE = 'Active',
    COMPLETED = 'Completed',
    BLOCKED = 'Blocked'
} 