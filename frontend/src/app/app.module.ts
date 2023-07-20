import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { RouterModule } from '@angular/router';
import { NavigationComponent } from './components/common/navigation/navigation.component';
import { HomeComponent } from './components/home/home.component';

import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { BarcodeDisplayDialogComponent } from './components/common/barcode-display-dialog/barcode-display-dialog.component';
import { LocationEditDialogComponent } from './components/locations/location-edit-dialog/location-edit-dialog.component';
import { LocationsLandingPageComponent } from './components/locations/locations-landing-page/locations-landing-page.component';
import { PartsLandingPageComponent } from './components/parts/parts-landing-page/parts-landing-page.component';
import { PartsTableComponent } from './components/parts/parts-table/parts-table.component';
import { ViewTraceDialogComponent } from './components/trace/view-trace-dialog/view-trace-dialog.component';
import { BarcodeTagComponent } from './components/common/barcode-tag/barcode-tag.component';
import { MoveBarcodeDialogComponent } from './components/common/move-barcode-dialog/move-barcode-dialog.component';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDialogModule } from '@angular/material/dialog';
import { AuthService } from './services/common/auth.service';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { MatInputModule } from '@angular/material/input';
import { AuthInterceptorService } from './services/common/auth-interceptor.service';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { ReactiveFormsModule } from '@angular/forms';
import { AuthGuard } from './guards/auth.guard';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTreeModule } from '@angular/material/tree';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { InventoryService } from './services/inventory/inventory.service';
import { PartEditDialogComponent } from './components/parts/part-edit-dialog/part-edit-dialog.component';
import { LogInDialogComponent } from './components/common/log-in-dialog/log-in-dialog.component';
const routes = [{
  path: '',
  component: HomeComponent
},
{
  path: 'locations',
  component: LocationsLandingPageComponent,
  // canActivate: [AuthGuard]
},
{
  path: 'parts',
  component: PartsLandingPageComponent,
  // canActivate: [AuthGuard]
},

];

@NgModule({
  declarations: [
    AppComponent,
    NavigationComponent,
    HomeComponent,
    BarcodeDisplayDialogComponent,
    LocationEditDialogComponent,
    LocationsLandingPageComponent,
    PartsLandingPageComponent,
    PartsTableComponent,
    ViewTraceDialogComponent,
    BarcodeTagComponent,
    MoveBarcodeDialogComponent,
    LocationEditDialogComponent,
    BarcodeDisplayDialogComponent,
    PartEditDialogComponent,
    LogInDialogComponent,
  ],
  imports: [
    RouterModule.forRoot(routes),
    AppRoutingModule,
    BrowserModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatDialogModule,
    MatInputModule,
    MatSnackBarModule,
    FormsModule,
    HttpClientModule,
    ReactiveFormsModule,
    MatExpansionModule,
    MatTableModule,
    MatPaginatorModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatDatepickerModule,
    MatTreeModule,
    MatAutocompleteModule

  ],
  providers: [
    AuthService,
    InventoryService,
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptorService,
      multi: true
    }
  ],
  bootstrap: [AppComponent],
  entryComponents: [
    // LogInDialogComponent,
  ]
})
export class AppModule { }
