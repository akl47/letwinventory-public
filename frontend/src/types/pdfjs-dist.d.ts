declare module 'pdfjs-dist' {
    interface TextItem {
        str: string;
        dir: string;
        transform: number[];
        width: number;
        height: number;
        hasEOL: boolean;
    }

    interface TextMarkedContent {
        type: string;
        id?: string;
    }

    interface TextContent {
        items: (TextItem | TextMarkedContent)[];
        styles: Record<string, any>;
    }

    interface PDFPageProxy {
        getTextContent(): Promise<TextContent>;
    }

    interface PDFDocumentProxy {
        numPages: number;
        getPage(pageNumber: number): Promise<PDFPageProxy>;
    }

    interface PDFDocumentLoadingTask {
        promise: Promise<PDFDocumentProxy>;
    }

    interface GlobalWorkerOptionsType {
        workerSrc: string;
    }

    export const GlobalWorkerOptions: GlobalWorkerOptionsType;
    export const version: string;
    export function getDocument(params: { data: ArrayBuffer }): PDFDocumentLoadingTask;
}
