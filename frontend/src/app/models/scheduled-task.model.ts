export interface ScheduledTask {
    id: number;
    ownerUserID: number;
    name: string;
    description?: string;
    taskListID: number;
    projectID?: number;
    taskTypeEnum: 'normal' | 'tracking' | 'critical_path' | 'scheduled';
    timeEstimate?: number;
    dueDateOffsetHours?: number;
    cronExpression: string;
    timezone: string;
    nextRunAt: Date;
    lastRunAt?: Date;
    activeFlag: boolean;
    createdAt: Date;
    updatedAt: Date;
    taskList?: { id: number; name: string };
    project?: { id: number; name: string; shortName: string; tagColorHex: string };
}
