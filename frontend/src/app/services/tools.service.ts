import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Tool, ToolCategory, ToolSubcategory, ToolWritePayload, ToolSubcategoryWritePayload } from '../models/tool.model';

@Injectable({ providedIn: 'root' })
export class ToolsService {
  private http = inject(HttpClient);
  private toolUrl = `${environment.apiUrl}/tools/tool`;
  private catUrl = `${environment.apiUrl}/tools/tool-category`;
  private subUrl = `${environment.apiUrl}/tools/tool-subcategory`;

  getTools(filters?: { categoryID?: number; subcategoryID?: number; q?: string; includeInactive?: boolean }): Observable<Tool[]> {
    const params: string[] = [];
    if (filters?.categoryID) params.push(`categoryID=${filters.categoryID}`);
    if (filters?.subcategoryID) params.push(`subcategoryID=${filters.subcategoryID}`);
    if (filters?.q) params.push(`q=${encodeURIComponent(filters.q)}`);
    if (filters?.includeInactive) params.push('includeInactive=true');
    const url = params.length ? `${this.toolUrl}?${params.join('&')}` : this.toolUrl;
    return this.http.get<Tool[]>(url);
  }

  getTool(id: number): Observable<Tool> {
    return this.http.get<Tool>(`${this.toolUrl}/${id}`);
  }

  getToolByPart(partID: number): Observable<Tool> {
    return this.http.get<Tool>(`${this.toolUrl}/by-part/${partID}`);
  }

  createTool(payload: ToolWritePayload): Observable<Tool> {
    return this.http.post<Tool>(this.toolUrl, payload);
  }

  updateTool(id: number, payload: ToolWritePayload): Observable<Tool> {
    return this.http.put<Tool>(`${this.toolUrl}/${id}`, payload);
  }

  deleteTool(id: number): Observable<any> {
    return this.http.delete(`${this.toolUrl}/${id}`);
  }

  // Categories
  getToolCategories(): Observable<ToolCategory[]> {
    return this.http.get<ToolCategory[]>(this.catUrl);
  }

  createToolCategory(payload: { name: string; description?: string }): Observable<ToolCategory> {
    return this.http.post<ToolCategory>(this.catUrl, payload);
  }

  updateToolCategory(id: number, payload: { name?: string; description?: string }): Observable<ToolCategory> {
    return this.http.put<ToolCategory>(`${this.catUrl}/${id}`, payload);
  }

  deleteToolCategory(id: number): Observable<any> {
    return this.http.delete(`${this.catUrl}/${id}`);
  }

  // Subcategories
  getToolSubcategories(filters?: { categoryID?: number }): Observable<ToolSubcategory[]> {
    const url = filters?.categoryID ? `${this.subUrl}?categoryID=${filters.categoryID}` : this.subUrl;
    return this.http.get<ToolSubcategory[]>(url);
  }

  createToolSubcategory(payload: ToolSubcategoryWritePayload): Observable<ToolSubcategory> {
    return this.http.post<ToolSubcategory>(this.subUrl, payload);
  }

  updateToolSubcategory(id: number, payload: Partial<ToolSubcategoryWritePayload>): Observable<ToolSubcategory> {
    return this.http.put<ToolSubcategory>(`${this.subUrl}/${id}`, payload);
  }

  deleteToolSubcategory(id: number): Observable<any> {
    return this.http.delete(`${this.subUrl}/${id}`);
  }
}
