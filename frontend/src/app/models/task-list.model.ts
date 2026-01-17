import { Task } from './task.model';

export interface TaskList {
    id: number;
    name: string;
    activeFlag: boolean;
    order: number;
    createdAt: Date;
    updatedAt: Date;
    tasks?: Task[];
}
