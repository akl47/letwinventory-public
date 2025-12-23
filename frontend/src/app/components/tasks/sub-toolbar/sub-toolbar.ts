import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-sub-toolbar',
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './sub-toolbar.html',
  styleUrl: './sub-toolbar.css',
})
export class SubToolbarComponent {
  @Output() toggleHistory = new EventEmitter<void>();
}
