import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { BASE_URL } from 'src/app/app.config';
import { LocationHigherarchy } from 'src/app/models/inventory/locationHigherarchy.model';
import { Barcode } from 'src/app/models/inventory/barcode.model';
import { Tag } from 'src/app/models/inventory/tag.model';
import { BarcodeCategory } from 'src/app/models/inventory/barcodeCategory.model';
import { Part } from 'src/app/models/inventory/part.model';
import { Trace } from 'src/app/models/inventory/trace.model';
import { catchError } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root'
})
export class InventoryService {

  constructor(
    private http: HttpClient,
    private snack: MatSnackBar
  ) { }

  //Barcodes 

  getAllBarcodes(): Observable<Barcode[]> {
    return this.http.get<Barcode[]>(BASE_URL + '/inventory/barcode').pipe(catchError(this.handleError.bind(this)))
  }

  getBarcodeZPL(barcodeID: number): Observable<any> {
    return this.http.get(BASE_URL + '/inventory/barcode/display/' + barcodeID,
      { responseType: 'text' }).pipe(catchError(this.handleError.bind(this)))
  }

  getAllTags(): Observable<Tag[]> {
    return this.http.get<Tag[]>(BASE_URL + '/inventory/barcode/tag').pipe(catchError(this.handleError.bind(this)))
  }

  getTagByID(barcodeID: number): Observable<Tag> {
    return this.http.get<Tag>(BASE_URL + '/inventory/barcode/tag/' + barcodeID).pipe(catchError(this.handleError.bind(this)))
  }

  getTagByChainID(barcodeID: number): Observable<Tag[]> {
    return this.http.get<Tag[]>(BASE_URL + '/inventory/barcode/tag/chain/' + barcodeID).pipe(catchError(this.handleError.bind(this)))
  }

  getBarcodeCategories(): Observable<BarcodeCategory[]> {
    return this.http.get<BarcodeCategory[]>(BASE_URL + '/inventory/barcode/category').pipe(catchError(this.handleError.bind(this)))
  }

  printBarcode(barcodeID: number): Observable<any> {
    return this.http.post(BASE_URL + '/inventory/barcode/print/' + barcodeID, '').pipe(catchError(this.handleError.bind(this)))
  }

  moveBarcode(barcodeID: number, newLocationID: number): Observable<any> {
    return this.http.post(BASE_URL + '/inventory/barcode/move/' + barcodeID, {
      "newLocationID": newLocationID
    }).pipe(catchError(this.handleError.bind(this)))
  }

  // Locations
  getAllLocations(): Observable<LocationHigherarchy> {
    return this.http.get<LocationHigherarchy>(BASE_URL + '/inventory/location/higherarchy').pipe(catchError(this.handleError.bind(this)));
  }

  updateByTag(tag: any): Observable<any> {
    return this.http.put(BASE_URL + '/inventory/' + tag.type + '/' + tag.id, tag).pipe(catchError(this.handleError.bind(this)))
  }

  createByTag(tag: any): Observable<any> {
    return this.http.post(BASE_URL + '/inventory/' + tag.type + '/', tag).pipe(catchError(this.handleError.bind(this)))
  }

  deleteByBarcodeID(barcodeID: number): Observable<any> {
    return this.http.delete(BASE_URL + '/inventory/barcode/' + barcodeID).pipe(catchError(this.handleError.bind(this)))
  }

  // Parts

  getAllParts(): Observable<Part[]> {
    return this.http.get<Part[]>(BASE_URL + '/inventory/part').pipe(catchError(this.handleError.bind(this)))
  }

  createPart(part: any): Observable<Part> {
    return this.http.post<Part>(BASE_URL + '/inventory/part', part).pipe(catchError(this.handleError.bind(this)))
  }

  updatePart(part: any): Observable<Part> {
    return this.http.put<Part>(BASE_URL + '/inventory/part/' + part.id, part).pipe(catchError(this.handleError.bind(this)))
  }

  deletePart(part: any): Observable<Part> {
    return this.http.delete<Part>(BASE_URL + '/inventory/part/' + part.id).pipe(catchError(this.handleError.bind(this)))
  }

  // Trace
  createTrace(partID: number, quantity: number, parentBarcodeID: number, orderItemID: number): Observable<Trace> {
    return this.http.post<Trace>(BASE_URL + '/inventory/trace', {
      partID: partID,
      quantity: quantity,
      parentBarcodeID: parentBarcodeID,
      orderItemID: orderItemID
    }).pipe(catchError(this.handleError.bind(this)))
  }

  getTracesByPartID(partID: number): Observable<Trace[]> {
    return this.http.get<Trace[]>(BASE_URL + '/inventory/trace?partID=' + partID).pipe(catchError(this.handleError.bind(this)))
  }

  testError() {
    return this.http.get(BASE_URL + '/inventory/part/error').pipe(catchError(this.handleError.bind(this)))
  }

  handleError(error: any) {
    console.log(error.error.errorMessage)
    let message
    if (typeof error.error.errorMessage != 'undefined') {
      message = error.error.errorMessage
    } else {
      message = error.message
    }
    this.snack.open(message, '', {
      duration: 5000
    })
    console.error(error)
    return throwError(error)
  }
}
