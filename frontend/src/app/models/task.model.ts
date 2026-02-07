export interface Task {
    id: number;
    ownerUserID: number;
    projectID: number;
    taskListID: number;
    name: string;
    description?: string;
    doneFlag: boolean;
    completeWithChildren: boolean;
    dueDate?: Date;
    timeEstimate?: number;
    parentTaskID?: number;
    rank: number;
    taskTypeEnum: 'normal' | 'tracking' | 'critical_path' | 'scheduled';
    activeFlag: boolean;
    createdAt: Date;
    updatedAt: Date;
    subtasks?: Task[];
}
