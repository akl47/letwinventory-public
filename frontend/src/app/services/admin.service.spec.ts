import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AdminService } from './admin.service';

const GROUP_URL = 'https://dev.letwin.co/api/admin/group';
const USER_URL = 'https://dev.letwin.co/api/admin/user';
const PERM_URL = 'https://dev.letwin.co/api/admin/permission';

describe('AdminService', () => {
    let service: AdminService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting()]
        });
        service = TestBed.inject(AdminService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    // --- Groups ---

    describe('getGroups', () => {
        it('should GET /admin/group', () => {
            const mockGroups = [{ id: 1, name: 'Admin' }];

            service.getGroups().subscribe(result => {
                expect(result).toEqual(mockGroups);
            });

            const req = httpMock.expectOne(GROUP_URL);
            expect(req.request.method).toBe('GET');
            req.flush(mockGroups);
        });
    });

    describe('getGroup', () => {
        it('should GET /admin/group/:id', () => {
            service.getGroup(3).subscribe(result => {
                expect(result.id).toBe(3);
            });

            const req = httpMock.expectOne(`${GROUP_URL}/3`);
            expect(req.request.method).toBe('GET');
            req.flush({ id: 3, name: 'Editors' });
        });
    });

    describe('createGroup', () => {
        it('should POST to /admin/group', () => {
            const data = { name: 'New Group', description: 'A group' };

            service.createGroup(data).subscribe();

            const req = httpMock.expectOne(GROUP_URL);
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual(data);
            req.flush({ id: 1, ...data });
        });
    });

    describe('updateGroup', () => {
        it('should PUT to /admin/group/:id', () => {
            const data = { name: 'Updated Group' };

            service.updateGroup(2, data).subscribe();

            const req = httpMock.expectOne(`${GROUP_URL}/2`);
            expect(req.request.method).toBe('PUT');
            expect(req.request.body).toEqual(data);
            req.flush({ id: 2, ...data });
        });
    });

    describe('deleteGroup', () => {
        it('should DELETE /admin/group/:id', () => {
            service.deleteGroup(5).subscribe();

            const req = httpMock.expectOne(`${GROUP_URL}/5`);
            expect(req.request.method).toBe('DELETE');
            req.flush(null);
        });
    });

    describe('addMember', () => {
        it('should POST to /admin/group/:id/member with userID', () => {
            service.addMember(1, 42).subscribe();

            const req = httpMock.expectOne(`${GROUP_URL}/1/member`);
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual({ userID: 42 });
            req.flush({});
        });
    });

    describe('removeMember', () => {
        it('should DELETE /admin/group/:groupId/member/:userId', () => {
            service.removeMember(1, 42).subscribe();

            const req = httpMock.expectOne(`${GROUP_URL}/1/member/42`);
            expect(req.request.method).toBe('DELETE');
            req.flush(null);
        });
    });

    // --- Users ---

    describe('getUsers', () => {
        it('should GET /admin/user', () => {
            const mockUsers = [{ id: 1, displayName: 'Alice', email: 'a@b.com' }];

            service.getUsers().subscribe(result => {
                expect(result).toEqual(mockUsers);
            });

            const req = httpMock.expectOne(USER_URL);
            expect(req.request.method).toBe('GET');
            req.flush(mockUsers);
        });
    });

    describe('getUser', () => {
        it('should GET /admin/user/:id', () => {
            service.getUser(7).subscribe();

            const req = httpMock.expectOne(`${USER_URL}/7`);
            expect(req.request.method).toBe('GET');
            req.flush({ id: 7, displayName: 'Bob' });
        });
    });

    describe('setUserPermissions', () => {
        it('should PUT to /admin/user/:id/permissions with permissionIds', () => {
            service.setUserPermissions(3, [1, 5, 9]).subscribe();

            const req = httpMock.expectOne(`${USER_URL}/3/permissions`);
            expect(req.request.method).toBe('PUT');
            expect(req.request.body).toEqual({ permissionIds: [1, 5, 9] });
            req.flush({});
        });
    });

    describe('createUser', () => {
        it('should POST to /admin/user', () => {
            const data = { email: 'new@test.com', displayName: 'New User' };

            service.createUser(data).subscribe();

            const req = httpMock.expectOne(USER_URL);
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual(data);
            req.flush({ id: 10, ...data });
        });
    });

    describe('deactivateUser', () => {
        it('should DELETE /admin/user/:id', () => {
            service.deactivateUser(8).subscribe();

            const req = httpMock.expectOne(`${USER_URL}/8`);
            expect(req.request.method).toBe('DELETE');
            req.flush(null);
        });
    });

    describe('activateUser', () => {
        it('should PUT to /admin/user/:id/active', () => {
            service.activateUser(8).subscribe();

            const req = httpMock.expectOne(`${USER_URL}/8/active`);
            expect(req.request.method).toBe('PUT');
            expect(req.request.body).toEqual({});
            req.flush({});
        });
    });

    describe('impersonateUser', () => {
        it('should POST to /admin/user/:id/impersonate', () => {
            const mockResponse = { token: 'jwt-abc', user: { id: 5 }, permissions: ['admin.read'] };

            service.impersonateUser(5).subscribe(result => {
                expect(result.token).toBe('jwt-abc');
                expect(result.permissions).toEqual(['admin.read']);
            });

            const req = httpMock.expectOne(`${USER_URL}/5/impersonate`);
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual({});
            req.flush(mockResponse);
        });
    });

    // --- Permissions ---

    describe('getPermissions', () => {
        it('should GET /admin/permission', () => {
            const mockPerms = [{ id: 1, resource: 'admin', action: 'read' }];

            service.getPermissions().subscribe(result => {
                expect(result).toEqual(mockPerms);
            });

            const req = httpMock.expectOne(PERM_URL);
            expect(req.request.method).toBe('GET');
            req.flush(mockPerms);
        });
    });
});
