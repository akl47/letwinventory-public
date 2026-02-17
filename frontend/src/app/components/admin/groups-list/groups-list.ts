import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AdminService } from '../../../services/admin.service';
import { UserGroup } from '../../../models/permission.model';

@Component({
  selector: 'app-groups-list',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './groups-list.html',
  styleUrl: './groups-list.css',
})
export class GroupsList implements OnInit {
  private adminService = inject(AdminService);
  private router = inject(Router);

  groups = signal<UserGroup[] | null>(null);

  displayedColumns: string[] = ['name', 'description', 'memberCount', 'actions'];

  ngOnInit() {
    this.loadGroups();
  }

  loadGroups() {
    this.adminService.getGroups().subscribe({
      next: (groups) => {
        this.groups.set(groups);
      },
      error: (err) => {
        console.error('Error loading groups:', err);
        this.groups.set([]);
      }
    });
  }

  deleteGroup(id: number) {
    this.adminService.deleteGroup(id).subscribe({
      next: () => {
        this.loadGroups();
      },
      error: (err) => {
        console.error('Error deleting group:', err);
      }
    });
  }

  navigateToNew() {
    this.router.navigate(['/admin/groups/new']);
  }

  navigateToEdit(id: number) {
    this.router.navigate(['/admin/groups', id]);
  }
}
