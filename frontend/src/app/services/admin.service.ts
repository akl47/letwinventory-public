import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Permission, UserGroup, AdminUser } from '../models/permission.model';
import { User } from '../services/auth.service';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class AdminService {
    private http = inject(HttpClient);
    private groupUrl = `${environment.apiUrl}/admin/group`;
    private userUrl = `${environment.apiUrl}/admin/user`;
    private permissionUrl = `${environment.apiUrl}/admin/permission`;

    // Groups
    getGroups(): Observable<UserGroup[]> {
        return this.http.get<UserGroup[]>(this.groupUrl);
    }

    getGroup(id: number): Observable<UserGroup> {
        return this.http.get<UserGroup>(`${this.groupUrl}/${id}`);
    }

    createGroup(data: Partial<UserGroup>): Observable<UserGroup> {
        return this.http.post<UserGroup>(this.groupUrl, data);
    }

    updateGroup(id: number, data: Partial<UserGroup>): Observable<UserGroup> {
        return this.http.put<UserGroup>(`${this.groupUrl}/${id}`, data);
    }

    deleteGroup(id: number): Observable<any> {
        return this.http.delete(`${this.groupUrl}/${id}`);
    }

    addMember(groupId: number, userId: number): Observable<any> {
        return this.http.post(`${this.groupUrl}/${groupId}/member`, { userID: userId });
    }

    removeMember(groupId: number, userId: number): Observable<any> {
        return this.http.delete(`${this.groupUrl}/${groupId}/member/${userId}`);
    }

    // Users
    getUsers(): Observable<AdminUser[]> {
        return this.http.get<AdminUser[]>(this.userUrl);
    }

    getUser(id: number): Observable<AdminUser> {
        return this.http.get<AdminUser>(`${this.userUrl}/${id}`);
    }

    setUserPermissions(userId: number, permissionIds: number[]): Observable<any> {
        return this.http.put(`${this.userUrl}/${userId}/permissions`, { permissionIds });
    }

    createUser(data: { email: string; displayName: string }): Observable<AdminUser> {
        return this.http.post<AdminUser>(this.userUrl, data);
    }

    deactivateUser(id: number): Observable<any> {
        return this.http.delete(`${this.userUrl}/${id}`);
    }

    activateUser(id: number): Observable<any> {
        return this.http.put(`${this.userUrl}/${id}/active`, {});
    }

    impersonateUser(userId: number): Observable<{ token: string; user: User; permissions: string[] }> {
        return this.http.post<{ token: string; user: User; permissions: string[] }>(`${this.userUrl}/${userId}/impersonate`, {});
    }

    // Permissions
    getPermissions(): Observable<Permission[]> {
        return this.http.get<Permission[]>(this.permissionUrl);
    }
}
