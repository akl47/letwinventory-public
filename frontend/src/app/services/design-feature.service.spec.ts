import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { DesignFeatureService } from './design-feature.service';

const API_URL = 'https://dev.letwin.co/api/design/feature';

describe('DesignFeatureService', () => {
    let service: DesignFeatureService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting()],
        });
        service = TestBed.inject(DesignFeatureService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpMock.verify());

    describe('getAll', () => {
        it('GETs /design/feature without filters', () => {
            service.getAll().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });

        it('appends projectID, reviewState, ownerUserID query params', () => {
            service.getAll({ projectID: 5, reviewState: 'in_review', ownerUserID: 7 }).subscribe();
            const req = httpMock.expectOne(r => r.url === API_URL);
            expect(req.request.params.get('projectID')).toBe('5');
            expect(req.request.params.get('reviewState')).toBe('in_review');
            expect(req.request.params.get('ownerUserID')).toBe('7');
            req.flush([]);
        });
    });

    describe('getById', () => {
        it('GETs /design/feature/:id', () => {
            service.getById(3).subscribe();
            const req = httpMock.expectOne(`${API_URL}/3`);
            expect(req.request.method).toBe('GET');
            req.flush({ id: 3 });
        });
    });

    describe('create', () => {
        it('POSTs to /design/feature', () => {
            const body = { name: 'New', slug: 'new', projectID: 1 };
            service.create(body).subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual(body);
            req.flush({ id: 99, ...body });
        });
    });

    describe('update', () => {
        it('PUTs to /design/feature/:id', () => {
            service.update(3, { description: 'changed' }).subscribe();
            const req = httpMock.expectOne(`${API_URL}/3`);
            expect(req.request.method).toBe('PUT');
            req.flush({ id: 3 });
        });
    });

    describe('softDelete', () => {
        it('DELETEs /design/feature/:id', () => {
            service.softDelete(3).subscribe();
            const req = httpMock.expectOne(`${API_URL}/3`);
            expect(req.request.method).toBe('DELETE');
            req.flush({ success: true });
        });
    });

    describe('workflow transitions', () => {
        ['submit', 'approve', 'reject', 'release'].forEach(action => {
            it(`POSTs /:id/${action}`, () => {
                (service as any)[action](3).subscribe();
                const req = httpMock.expectOne(`${API_URL}/3/${action}`);
                expect(req.request.method).toBe('POST');
                req.flush({ id: 3 });
            });
        });
    });

    describe('linkRequirement / unlinkRequirement', () => {
        it('POSTs link-requirement', () => {
            service.linkRequirement(3, 42).subscribe();
            const req = httpMock.expectOne(`${API_URL}/3/link-requirement`);
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual({ requirementID: 42 });
            req.flush({ success: true });
        });

        it('DELETEs link-requirement/:reqId', () => {
            service.unlinkRequirement(3, 42).subscribe();
            const req = httpMock.expectOne(`${API_URL}/3/link-requirement/42`);
            expect(req.request.method).toBe('DELETE');
            req.flush({ success: true });
        });
    });

    describe('history', () => {
        it('GETs /:id/history with pagination params', () => {
            service.getHistory(3, { limit: 10, offset: 20 }).subscribe();
            const req = httpMock.expectOne(r => r.url === `${API_URL}/3/history`);
            expect(req.request.params.get('limit')).toBe('10');
            expect(req.request.params.get('offset')).toBe('20');
            req.flush([]);
        });
    });
});
