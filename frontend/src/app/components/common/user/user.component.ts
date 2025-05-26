import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { UserService } from '../../../services/common/user.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '../../../models/common/user.model';

@Component({
    selector: 'app-user',
    templateUrl: './user.component.html',
    styleUrls: ['./user.component.scss'],
    standalone: false
})
export class UserComponent implements OnInit {
  userForm: FormGroup;
  isLoading = false;

  constructor(
    private fb: FormBuilder,
    private userService: UserService,
    private snack: MatSnackBar
  ) {
    this.userForm = this.fb.group({
      displayName: ['', [Validators.required, Validators.minLength(2)]]
    });
  }

  ngOnInit() {
    // Fetch user info when component initializes
    this.fetchUser();
  }

  fetchUser() {
    this.isLoading = true;
    this.userService.fetchUser().subscribe({
      next: (user: User) => {
        console.log(user)
        this.userForm.patchValue({
          displayName: user.displayName
        });
        this.isLoading = false;
      },
      error: (error) => {
        this.snack.open('Error loading user information', 'Close', {
          duration: 5000,
        });
        this.isLoading = false;
      }
    });
  }

  onSubmit() {
    if (this.userForm.valid) {
      this.isLoading = true;
      this.userService.updateUser(this.userForm.value).subscribe({
        next: (updatedUser: User) => {
          this.snack.open('Profile updated successfully', 'Close', {
            duration: 3000,
          });
          this.isLoading = false;
        },
        error: (error) => {
          this.snack.open('Error updating profile', 'Close', {
            duration: 5000,
          });
          this.isLoading = false;
        }
      });
    }
  }
}
