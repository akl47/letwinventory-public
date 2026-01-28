import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  input,
  output,
  signal,
  effect,
  inject,
  PLATFORM_ID,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  HarnessData,
  HarnessConnector,
  HarnessConnection,
  HarnessCable,
  HarnessComponent,
} from '../../../models/harness.model';
import {
  drawConnector,
  drawWire,
  drawWirePreview,
  drawGrid,
  drawCable,
  drawComponent,
  drawPinHighlight,
  hitTestConnector,
  hitTestPin,
  hitTestWire,
  hitTestCable,
  hitTestCableWire,
  hitTestComponent,
  hitTestComponentPin,
  hitTestConnectorButton,
  hitTestCableButton,
  hitTestComponentButton,
  hitTestWireControlPoint,
  hitTestWireLabelHandle,
  getPositionFromPoint,
  getConnectorPinPositions,
  getCableWirePositions,
  getComponentPinPositions,
  getWireControlPoints,
  calculateOrthogonalPath,
} from '../../../utils/harness/canvas-renderer';

export interface CanvasSelection {
  type: 'connector' | 'wire' | 'cable' | 'component' | 'none';
  connector?: HarnessConnector;
  connection?: HarnessConnection;
  cable?: HarnessCable;
  component?: HarnessComponent;
}

@Component({
  selector: 'app-harness-canvas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './harness-canvas.html',
  styleUrls: ['./harness-canvas.scss']
})
export class HarnessCanvas implements AfterViewInit, OnDestroy {
  private platformId = inject(PLATFORM_ID);

  @ViewChild('canvasContainer') canvasContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('mainCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  // Inputs
  harnessData = input<HarnessData | null>(null);
  activeTool = input<string>('select');
  gridEnabled = input<boolean>(true);
  snapToGrid = input<boolean>(true);
  gridSize = input<number>(20);

  // Outputs
  selectionChanged = output<CanvasSelection>();
  dataChanged = output<HarnessData>();
  connectorMoved = output<{ connector: HarnessConnector; x: number; y: number }>();
  cableMoved = output<{ cable: HarnessCable; x: number; y: number }>();
  componentMoved = output<{ component: HarnessComponent; x: number; y: number }>();
  editConnector = output<HarnessConnector>();
  editCable = output<HarnessCable>();
  editComponent = output<HarnessComponent>();
  bringToFront = output<void>();
  moveForward = output<void>();
  moveBackward = output<void>();
  sendToBack = output<void>();
  rotateSelected = output<void>();
  flipSelected = output<void>();
  requestDelete = output<void>();

  // Context menu state
  contextMenuVisible = false;
  contextMenuX = 0;
  contextMenuY = 0;
  contextMenuTarget: 'connector' | 'cable' | 'component' | null = null;

  // Canvas state
  private ctx: CanvasRenderingContext2D | null = null;
  private canvasWidth = 800;
  private canvasHeight = 600;

  // View transform
  zoom = signal<number>(1);
  private panX = 0;
  private panY = 0;

  // Interaction state
  private selectedConnectorId: string | null = null;
  private selectedConnectionId: string | null = null;
  private selectedCableId: string | null = null;
  private selectedComponentId: string | null = null;
  private isDragging = false;
  private isDraggingCable = false;
  private isDraggingComponent = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  // Panning state
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;

  // Wire drawing state
  private isDrawingWire = false;
  private wireStartConnectorId: string | null = null;
  private wireStartPinId: string | null = null;
  private wireStartCableId: string | null = null;
  private wireStartWireId: string | null = null;
  private wireStartSide: 'left' | 'right' | null = null;
  private wireStartComponentId: string | null = null;
  private wireStartComponentPinId: string | null = null;
  private wireEndX = 0;
  private wireEndY = 0;
  private hoveredPinConnectorId: string | null = null;
  private hoveredPinId: string | null = null;
  private hoveredCableId: string | null = null;
  private hoveredCableWireId: string | null = null;
  private hoveredCableSide: 'left' | 'right' | null = null;
  private hoveredComponentId: string | null = null;
  private hoveredComponentPinId: string | null = null;

  // Wire control point dragging state
  private isDraggingControlPoint = false;
  private draggedConnectionId: string | null = null;
  private draggedControlPointIndex: number = -1;

  // Wire label dragging state
  private isDraggingLabel = false;
  private draggedLabelConnectionId: string | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private animationFrameId: number | null = null;

  // Image cache for connector images
  private loadedImages = new Map<string, HTMLImageElement>();
  private loadingImages = new Set<string>();

  constructor() {
    // React to harness data changes
    effect(() => {
      const data = this.harnessData();
      if (data) {
        this.render();
      }
    });

    // React to grid settings
    effect(() => {
      this.gridEnabled();
      this.render();
    });
  }

  ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      this.initCanvas();
    }
  }

  ngOnDestroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  private initCanvas() {
    const canvas = this.canvasRef.nativeElement;
    const container = this.canvasContainer.nativeElement;

    this.ctx = canvas.getContext('2d');
    if (!this.ctx) return;

    // Set initial size
    this.resizeCanvas();

    // Setup resize observer
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
    });
    this.resizeObserver.observe(container);

    // Initial render
    this.render();
  }

  private resizeCanvas() {
    const canvas = this.canvasRef.nativeElement;
    const container = this.canvasContainer.nativeElement;

    const dpr = window.devicePixelRatio || 1;
    this.canvasWidth = container.clientWidth;
    this.canvasHeight = container.clientHeight;

    canvas.width = this.canvasWidth * dpr;
    canvas.height = this.canvasHeight * dpr;
    canvas.style.width = `${this.canvasWidth}px`;
    canvas.style.height = `${this.canvasHeight}px`;

    if (this.ctx) {
      this.ctx.scale(dpr, dpr);
    }

    this.render();
  }

  // Load an image from base64 data URL and cache it
  private loadImage(key: string, base64Data: string): void {
    if (this.loadedImages.has(key) || this.loadingImages.has(key)) {
      return;
    }

    this.loadingImages.add(key);
    const img = new Image();
    img.onload = () => {
      this.loadedImages.set(key, img);
      this.loadingImages.delete(key);
      this.render();
    };
    img.onerror = () => {
      this.loadingImages.delete(key);
    };
    img.src = base64Data;
  }

  // Preload images for connectors that have them visible
  private preloadConnectorImages(connectors: HarnessConnector[]): void {
    for (const connector of connectors) {
      if (connector.showPinoutDiagram && connector.pinoutDiagramImage) {
        this.loadImage(`pinout-${connector.id}`, connector.pinoutDiagramImage);
      }
      if (connector.showConnectorImage && connector.connectorImage) {
        this.loadImage(`connector-${connector.id}`, connector.connectorImage);
      }
    }
  }

  // Preload images for cables that have them visible
  private preloadCableImages(cables: HarnessCable[]): void {
    for (const cable of cables) {
      if (cable.showCableDiagram && cable.cableDiagramImage) {
        this.loadImage(`cable-diagram-${cable.id}`, cable.cableDiagramImage);
      }
    }
  }

  // Preload images for components that have them visible
  private preloadComponentImages(components: HarnessComponent[]): void {
    for (const component of components) {
      if (component.showPinoutDiagram && component.pinoutDiagramImage) {
        this.loadImage(`component-pinout-${component.id}`, component.pinoutDiagramImage);
      }
      if (component.showComponentImage && component.componentImage) {
        this.loadImage(`component-img-${component.id}`, component.componentImage);
      }
    }
  }

  private render() {
    if (!this.ctx) return;

    const ctx = this.ctx;
    const data = this.harnessData();

    // Clear canvas (dark mode)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    ctx.restore();

    // Draw grid in screen space (before view transform for consistent line widths)
    if (this.gridEnabled()) {
      drawGrid(ctx, this.canvasWidth, this.canvasHeight, this.gridSize(), this.panX, this.panY, this.zoom());
    }

    // Apply view transform for drawing elements
    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom(), this.zoom());

    if (data) {
      // Draw wires first (behind connectors and cables)
      data.connections.forEach(connection => {
        let fromPos: { x: number; y: number } | null = null;
        let toPos: { x: number; y: number } | null = null;
        let wireColor = 'BK';

        // Get from position (connector pin, cable wire, or component pin)
        if (connection.fromConnector && connection.fromPin) {
          const fromConnector = data.connectors.find(c => c.id === connection.fromConnector);
          if (fromConnector) {
            const fromPins = getConnectorPinPositions(fromConnector);
            const pin = fromPins.find(p => p.pinId === connection.fromPin);
            if (pin) fromPos = pin;
          }
        } else if (connection.fromCable && connection.fromWire && connection.fromSide) {
          const fromCable = data.cables.find(c => c.id === connection.fromCable);
          if (fromCable) {
            const cableWires = getCableWirePositions(fromCable);
            const wire = cableWires.find(w => w.wireId === connection.fromWire && w.side === connection.fromSide);
            if (wire) {
              fromPos = wire;
              const cableWire = fromCable.wires.find(w => w.id === connection.fromWire);
              if (cableWire) wireColor = cableWire.colorCode || cableWire.color || 'BK';
            }
          }
        } else if (connection.fromComponent && connection.fromComponentPin) {
          const fromComponent = (data.components || []).find(c => c.id === connection.fromComponent);
          if (fromComponent) {
            const compPins = getComponentPinPositions(fromComponent);
            const pin = compPins.find(p => p.pinId === connection.fromComponentPin);
            if (pin) fromPos = pin;
          }
        }

        // Get to position (connector pin, cable wire, or component pin)
        if (connection.toConnector && connection.toPin) {
          const toConnector = data.connectors.find(c => c.id === connection.toConnector);
          if (toConnector) {
            const toPins = getConnectorPinPositions(toConnector);
            const pin = toPins.find(p => p.pinId === connection.toPin);
            if (pin) toPos = pin;
          }
        } else if (connection.toCable && connection.toWire && connection.toSide) {
          const toCable = data.cables.find(c => c.id === connection.toCable);
          if (toCable) {
            const cableWires = getCableWirePositions(toCable);
            const wire = cableWires.find(w => w.wireId === connection.toWire && w.side === connection.toSide);
            if (wire) {
              toPos = wire;
              if (wireColor === 'BK') {
                const cableWire = toCable.wires.find(w => w.id === connection.toWire);
                if (cableWire) wireColor = cableWire.colorCode || cableWire.color || 'BK';
              }
            }
          }
        } else if (connection.toComponent && connection.toComponentPin) {
          const toComponent = (data.components || []).find(c => c.id === connection.toComponent);
          if (toComponent) {
            const compPins = getComponentPinPositions(toComponent);
            const pin = compPins.find(p => p.pinId === connection.toComponentPin);
            if (pin) toPos = pin;
          }
        }

        // Draw the wire if we have both endpoints
        if (fromPos && toPos) {
          // Override wire color if explicitly set
          if (connection.color) {
            wireColor = connection.color;
          }

          const isSelected = this.selectedConnectionId === connection.id;
          drawWire(ctx, connection, fromPos, toPos, wireColor, isSelected, this.gridSize());
        }
      });

      // Preload any visible cable, connector, and component images
      this.preloadCableImages(data.cables);
      this.preloadConnectorImages(data.connectors);
      this.preloadComponentImages(data.components || []);

      // Create a combined list of elements with their zIndex for sorting
      type DrawableElement =
        | { type: 'cable'; element: typeof data.cables[0] }
        | { type: 'connector'; element: typeof data.connectors[0] }
        | { type: 'component'; element: HarnessComponent };

      const elements: DrawableElement[] = [
        ...data.cables.filter(c => c.position).map(cable => ({ type: 'cable' as const, element: cable })),
        ...data.connectors.map(connector => ({ type: 'connector' as const, element: connector })),
        ...(data.components || []).map(component => ({ type: 'component' as const, element: component }))
      ];

      // Sort by zIndex (lower values drawn first, appearing behind)
      elements.sort((a, b) => (a.element.zIndex || 0) - (b.element.zIndex || 0));

      // Draw all elements in zIndex order
      elements.forEach(item => {
        if (item.type === 'cable') {
          const isSelected = this.selectedCableId === item.element.id;
          drawCable(ctx, item.element, isSelected, this.loadedImages);
        } else if (item.type === 'connector') {
          const isSelected = this.selectedConnectorId === item.element.id;
          drawConnector(ctx, item.element, isSelected, this.loadedImages);
        } else if (item.type === 'component') {
          const isSelected = this.selectedComponentId === item.element.id;
          drawComponent(ctx, item.element, isSelected, this.loadedImages);
        }
      });

      // Draw wire preview if drawing
      if (this.isDrawingWire) {
        let startX = this.wireEndX;
        let startY = this.wireEndY;
        let startPinPos: { x: number; y: number } | null = null;

        if (this.wireStartConnectorId && this.wireStartPinId) {
          const startConnector = data.connectors.find(c => c.id === this.wireStartConnectorId);
          if (startConnector) {
            const pins = getConnectorPinPositions(startConnector);
            const startPin = pins.find(p => p.pinId === this.wireStartPinId);
            if (startPin) {
              startX = startPin.x;
              startY = startPin.y;
              startPinPos = startPin;
            }
          }
        } else if (this.wireStartCableId && this.wireStartWireId && this.wireStartSide) {
          const startCable = data.cables.find(c => c.id === this.wireStartCableId);
          if (startCable) {
            const wires = getCableWirePositions(startCable);
            const wire = wires.find(w => w.wireId === this.wireStartWireId && w.side === this.wireStartSide);
            if (wire) {
              startX = wire.x;
              startY = wire.y;
              startPinPos = wire;
            }
          }
        } else if (this.wireStartComponentId && this.wireStartComponentPinId) {
          const startComponent = (data.components || []).find(c => c.id === this.wireStartComponentId);
          if (startComponent) {
            const pins = getComponentPinPositions(startComponent);
            const startPin = pins.find(p => p.pinId === this.wireStartComponentPinId);
            if (startPin) {
              startX = startPin.x;
              startY = startPin.y;
              startPinPos = startPin;
            }
          }
        }

        if (startX !== this.wireEndX || startY !== this.wireEndY) {
          drawWirePreview(ctx, startX, startY, this.wireEndX, this.wireEndY, this.gridSize());
        }

        // Draw green highlight on start pin (connector, cable, or component)
        if (startPinPos) {
          drawPinHighlight(ctx, startPinPos.x, startPinPos.y, true);
        }

        // Draw green highlight on hovered end pin (connector)
        if (this.hoveredPinConnectorId && this.hoveredPinId) {
          const hoveredConnector = data.connectors.find(c => c.id === this.hoveredPinConnectorId);
          if (hoveredConnector) {
            const pins = getConnectorPinPositions(hoveredConnector);
            const hoveredPin = pins.find(p => p.pinId === this.hoveredPinId);
            if (hoveredPin) {
              drawPinHighlight(ctx, hoveredPin.x, hoveredPin.y, false);
            }
          }
        }

        // Draw green highlight on hovered end pin (cable wire)
        if (this.hoveredCableId && this.hoveredCableWireId && this.hoveredCableSide) {
          const hoveredCable = data.cables.find(c => c.id === this.hoveredCableId);
          if (hoveredCable) {
            const wires = getCableWirePositions(hoveredCable);
            const hoveredWire = wires.find(w => w.wireId === this.hoveredCableWireId && w.side === this.hoveredCableSide);
            if (hoveredWire) {
              drawPinHighlight(ctx, hoveredWire.x, hoveredWire.y, false);
            }
          }
        }

        // Draw green highlight on hovered end pin (component)
        if (this.hoveredComponentId && this.hoveredComponentPinId) {
          const hoveredComponent = (data.components || []).find(c => c.id === this.hoveredComponentId);
          if (hoveredComponent) {
            const pins = getComponentPinPositions(hoveredComponent);
            const hoveredPin = pins.find(p => p.pinId === this.hoveredComponentPinId);
            if (hoveredPin) {
              drawPinHighlight(ctx, hoveredPin.x, hoveredPin.y, false);
            }
          }
        }
      }
    }

    ctx.restore();
  }

  // Convert screen coordinates to canvas coordinates
  private screenToCanvas(screenX: number, screenY: number): { x: number; y: number } {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const x = (screenX - rect.left - this.panX) / this.zoom();
    const y = (screenY - rect.top - this.panY) / this.zoom();
    return { x, y };
  }

  onMouseDown(event: MouseEvent) {
    const { x, y } = this.screenToCanvas(event.clientX, event.clientY);
    const data = this.harnessData();
    if (!data) return;

    // Middle mouse button for panning
    if (event.button === 1 || this.activeTool() === 'pan') {
      this.isPanning = true;
      this.panStartX = event.clientX - this.panX;
      this.panStartY = event.clientY - this.panY;
      this.canvasRef.nativeElement.style.cursor = 'grabbing';
      return;
    }

    // Wire drawing tool - check connector pins, cable wire endpoints, and component pins
    if (this.activeTool() === 'wire') {
      // Check connector pins first
      for (const connector of data.connectors) {
        const pinId = hitTestPin(connector, x, y);
        if (pinId) {
          this.isDrawingWire = true;
          this.wireStartConnectorId = connector.id;
          this.wireStartPinId = pinId;
          this.wireStartCableId = null;
          this.wireStartWireId = null;
          this.wireStartSide = null;
          this.wireStartComponentId = null;
          this.wireStartComponentPinId = null;
          this.wireEndX = x;
          this.wireEndY = y;
          return;
        }
      }
      // Check cable wire endpoints
      for (const cable of data.cables) {
        if (!cable.position) continue;
        const hit = hitTestCableWire(cable, x, y);
        if (hit) {
          this.isDrawingWire = true;
          this.wireStartCableId = cable.id;
          this.wireStartWireId = hit.wireId;
          this.wireStartSide = hit.side;
          this.wireStartConnectorId = null;
          this.wireStartPinId = null;
          this.wireStartComponentId = null;
          this.wireStartComponentPinId = null;
          this.wireEndX = x;
          this.wireEndY = y;
          return;
        }
      }
      // Check component pins
      for (const component of (data.components || [])) {
        const hit = hitTestComponentPin(component, x, y);
        if (hit) {
          this.isDrawingWire = true;
          this.wireStartComponentId = component.id;
          this.wireStartComponentPinId = hit.pinId;
          this.wireStartConnectorId = null;
          this.wireStartPinId = null;
          this.wireStartCableId = null;
          this.wireStartWireId = null;
          this.wireStartSide = null;
          this.wireEndX = x;
          this.wireEndY = y;
          return;
        }
      }
      return;
    }

    // Select tool
    // First check if clicking on a connector pin circle (to start wire drawing)
    for (const connector of data.connectors) {
      const pinId = hitTestPin(connector, x, y);
      if (pinId) {
        this.isDrawingWire = true;
        this.wireStartConnectorId = connector.id;
        this.wireStartPinId = pinId;
        this.wireStartCableId = null;
        this.wireStartWireId = null;
        this.wireStartSide = null;
        this.wireStartComponentId = null;
        this.wireStartComponentPinId = null;
        this.wireEndX = x;
        this.wireEndY = y;
        return;
      }
    }

    // Check cable wire endpoints (to start wire drawing)
    for (const cable of data.cables) {
      if (!cable.position) continue;
      const hit = hitTestCableWire(cable, x, y);
      if (hit) {
        this.isDrawingWire = true;
        this.wireStartCableId = cable.id;
        this.wireStartWireId = hit.wireId;
        this.wireStartSide = hit.side;
        this.wireStartConnectorId = null;
        this.wireStartPinId = null;
        this.wireStartComponentId = null;
        this.wireStartComponentPinId = null;
        this.wireEndX = x;
        this.wireEndY = y;
        return;
      }
    }

    // Check component pins (to start wire drawing)
    for (const component of (data.components || [])) {
      const hit = hitTestComponentPin(component, x, y);
      if (hit) {
        this.isDrawingWire = true;
        this.wireStartComponentId = component.id;
        this.wireStartComponentPinId = hit.pinId;
        this.wireStartConnectorId = null;
        this.wireStartPinId = null;
        this.wireStartCableId = null;
        this.wireStartWireId = null;
        this.wireStartSide = null;
        this.wireEndX = x;
        this.wireEndY = y;
        return;
      }
    }

    // Create sorted list of all elements by zIndex (highest first for hit testing)
    type HitTestElement =
      | { type: 'connector'; element: typeof data.connectors[0] }
      | { type: 'cable'; element: typeof data.cables[0] }
      | { type: 'component'; element: HarnessComponent };

    const elements: HitTestElement[] = [
      ...data.connectors.map(c => ({ type: 'connector' as const, element: c })),
      ...data.cables.filter(c => c.position).map(c => ({ type: 'cable' as const, element: c })),
      ...(data.components || []).map(c => ({ type: 'component' as const, element: c }))
    ];

    // Sort by zIndex descending (highest first - topmost elements checked first)
    elements.sort((a, b) => (b.element.zIndex || 0) - (a.element.zIndex || 0));

    // Check for expand button clicks first (in zIndex order)
    for (const item of elements) {
      if (item.type === 'connector') {
        const buttonHit = hitTestConnectorButton(item.element, x, y);
        if (buttonHit) {
          const updatedConnector = { ...item.element };
          if (buttonHit === 'pinout') {
            updatedConnector.showPinoutDiagram = !item.element.showPinoutDiagram;
          } else if (buttonHit === 'connectorImage') {
            updatedConnector.showConnectorImage = !item.element.showConnectorImage;
          }
          const connectors = data.connectors.map(c =>
            c.id === updatedConnector.id ? updatedConnector : c
          );
          this.dataChanged.emit({ ...data, connectors });
          return;
        }
      } else if (item.type === 'cable') {
        const buttonHit = hitTestCableButton(item.element, x, y);
        if (buttonHit) {
          const updatedCable = { ...item.element, showCableDiagram: !item.element.showCableDiagram };
          const cables = data.cables.map(c =>
            c.id === updatedCable.id ? updatedCable : c
          );
          this.dataChanged.emit({ ...data, cables });
          return;
        }
      } else if (item.type === 'component') {
        const buttonHit = hitTestComponentButton(item.element, x, y);
        if (buttonHit) {
          const updatedComponent = { ...item.element };
          if (buttonHit === 'pinout') {
            updatedComponent.showPinoutDiagram = !item.element.showPinoutDiagram;
          } else if (buttonHit === 'componentImage') {
            updatedComponent.showComponentImage = !item.element.showComponentImage;
          }
          const components = (data.components || []).map(c =>
            c.id === updatedComponent.id ? updatedComponent : c
          );
          this.dataChanged.emit({ ...data, components });
          return;
        }
      }
    }

    // Check for body hits (in zIndex order)
    for (const item of elements) {
      if (item.type === 'connector') {
        if (hitTestConnector(item.element, x, y)) {
          this.selectedConnectorId = item.element.id;
          this.selectedConnectionId = null;
          this.selectedCableId = null;
          this.selectedComponentId = null;
          this.isDragging = true;
          this.isDraggingCable = false;
          this.isDraggingComponent = false;
          this.dragStartX = x;
          this.dragStartY = y;
          this.dragOffsetX = x - (item.element.position?.x || 0);
          this.dragOffsetY = y - (item.element.position?.y || 0);

          this.selectionChanged.emit({
            type: 'connector',
            connector: item.element
          });
          this.render();
          return;
        }
      } else if (item.type === 'cable') {
        if (hitTestCable(item.element, x, y)) {
          this.selectedCableId = item.element.id;
          this.selectedConnectorId = null;
          this.selectedConnectionId = null;
          this.selectedComponentId = null;
          this.isDragging = false;
          this.isDraggingCable = true;
          this.isDraggingComponent = false;
          this.dragStartX = x;
          this.dragStartY = y;
          this.dragOffsetX = x - (item.element.position?.x || 0);
          this.dragOffsetY = y - (item.element.position?.y || 0);

          this.selectionChanged.emit({
            type: 'cable',
            cable: item.element
          });
          this.render();
          return;
        }
      } else if (item.type === 'component') {
        if (hitTestComponent(item.element, x, y)) {
          this.selectedComponentId = item.element.id;
          this.selectedConnectorId = null;
          this.selectedConnectionId = null;
          this.selectedCableId = null;
          this.isDragging = false;
          this.isDraggingCable = false;
          this.isDraggingComponent = true;
          this.dragStartX = x;
          this.dragStartY = y;
          this.dragOffsetX = x - (item.element.position?.x || 0);
          this.dragOffsetY = y - (item.element.position?.y || 0);

          this.selectionChanged.emit({
            type: 'component',
            component: item.element
          });
          this.render();
          return;
        }
      }
    }

    // Check for wire label handle hit (if a wire is selected and has a label)
    if (this.selectedConnectionId) {
      const selectedConnection = data.connections.find(c => c.id === this.selectedConnectionId);
      if (selectedConnection && selectedConnection.label) {
        const connFromPos = this.getConnectionFromPos(data, selectedConnection);
        const connToPos = this.getConnectionToPos(data, selectedConnection);

        if (connFromPos && connToPos) {
          if (hitTestWireLabelHandle(selectedConnection, connFromPos, connToPos, x, y, this.gridSize())) {
            this.isDraggingLabel = true;
            this.draggedLabelConnectionId = selectedConnection.id;
            return;
          }
        }
      }
    }

    // Check for wire control point hit (if a wire is selected)
    if (this.selectedConnectionId) {
      const selectedConnection = data.connections.find(c => c.id === this.selectedConnectionId);
      if (selectedConnection) {
        const connFromPos = this.getConnectionFromPos(data, selectedConnection);
        const connToPos = this.getConnectionToPos(data, selectedConnection);

        if (connFromPos && connToPos) {
          const cpIndex = hitTestWireControlPoint(selectedConnection, connFromPos, connToPos, x, y, this.gridSize());
          if (cpIndex >= 0) {
            this.isDraggingControlPoint = true;
            this.draggedConnectionId = selectedConnection.id;
            this.draggedControlPointIndex = cpIndex;
            return;
          }
        }
      }
    }

    // Check for wire hit
    for (const connection of data.connections) {
      const fromPos = this.getConnectionFromPos(data, connection);
      const toPos = this.getConnectionToPos(data, connection);

      if (fromPos && toPos && hitTestWire(connection, fromPos, toPos, x, y, this.gridSize())) {
        this.selectedConnectionId = connection.id;
        this.selectedConnectorId = null;
        this.selectedCableId = null;
        this.selectedComponentId = null;
        this.selectionChanged.emit({
          type: 'wire',
          connection: connection
        });
        this.render();
        return;
      }
    }

    // Clicked on empty space - clear selection
    this.selectedConnectorId = null;
    this.selectedConnectionId = null;
    this.selectedCableId = null;
    this.selectedComponentId = null;
    this.selectionChanged.emit({ type: 'none' });
    this.render();
  }

  onMouseMove(event: MouseEvent) {
    const { x, y } = this.screenToCanvas(event.clientX, event.clientY);

    // Panning
    if (this.isPanning) {
      this.panX = event.clientX - this.panStartX;
      this.panY = event.clientY - this.panStartY;
      this.render();
      return;
    }

    // Wire drawing
    if (this.isDrawingWire) {
      this.wireEndX = x;
      this.wireEndY = y;

      // Track hovered pin for green indicator
      this.hoveredPinConnectorId = null;
      this.hoveredPinId = null;
      this.hoveredCableId = null;
      this.hoveredCableWireId = null;
      this.hoveredCableSide = null;
      this.hoveredComponentId = null;
      this.hoveredComponentPinId = null;

      const data = this.harnessData();
      if (data) {
        // Check connector pins
        for (const connector of data.connectors) {
          // Don't highlight the start connector's start pin
          if (connector.id === this.wireStartConnectorId) continue;

          const pinId = hitTestPin(connector, x, y);
          if (pinId) {
            this.hoveredPinConnectorId = connector.id;
            this.hoveredPinId = pinId;
            break;
          }
        }

        // Check cable wire endpoints if no connector pin found
        if (!this.hoveredPinConnectorId) {
          for (const cable of data.cables) {
            if (!cable.position) continue;
            // Don't highlight the start cable's wire
            if (cable.id === this.wireStartCableId) continue;

            const hit = hitTestCableWire(cable, x, y);
            if (hit) {
              this.hoveredCableId = cable.id;
              this.hoveredCableWireId = hit.wireId;
              this.hoveredCableSide = hit.side;
              break;
            }
          }
        }

        // Check component pins if no connector pin or cable wire found
        if (!this.hoveredPinConnectorId && !this.hoveredCableId) {
          for (const component of (data.components || [])) {
            // Don't highlight the start component's pin
            if (component.id === this.wireStartComponentId) continue;

            const hit = hitTestComponentPin(component, x, y);
            if (hit) {
              this.hoveredComponentId = component.id;
              this.hoveredComponentPinId = hit.pinId;
              break;
            }
          }
        }
      }

      this.render();
      return;
    }

    // Dragging connector
    if (this.isDragging && this.selectedConnectorId) {
      const data = this.harnessData();
      if (!data) return;

      let newX = x - this.dragOffsetX;
      let newY = y - this.dragOffsetY;

      // Snap to grid
      if (this.snapToGrid()) {
        const grid = this.gridSize();
        newX = Math.round(newX / grid) * grid;
        newY = Math.round(newY / grid) * grid;
      }

      // Update connector position
      const connectors = data.connectors.map(c => {
        if (c.id === this.selectedConnectorId) {
          return { ...c, position: { x: newX, y: newY } };
        }
        return c;
      });

      this.dataChanged.emit({ ...data, connectors });
    }

    // Dragging cable
    if (this.isDraggingCable && this.selectedCableId) {
      const data = this.harnessData();
      if (!data) return;

      let newX = x - this.dragOffsetX;
      let newY = y - this.dragOffsetY;

      // Snap to grid
      if (this.snapToGrid()) {
        const grid = this.gridSize();
        newX = Math.round(newX / grid) * grid;
        newY = Math.round(newY / grid) * grid;
      }

      // Update cable position
      const cables = data.cables.map(c => {
        if (c.id === this.selectedCableId) {
          return { ...c, position: { x: newX, y: newY } };
        }
        return c;
      });

      this.dataChanged.emit({ ...data, cables });
    }

    // Dragging component
    if (this.isDraggingComponent && this.selectedComponentId) {
      const data = this.harnessData();
      if (!data) return;

      let newX = x - this.dragOffsetX;
      let newY = y - this.dragOffsetY;

      // Snap to grid
      if (this.snapToGrid()) {
        const grid = this.gridSize();
        newX = Math.round(newX / grid) * grid;
        newY = Math.round(newY / grid) * grid;
      }

      // Update component position
      const components = (data.components || []).map(c => {
        if (c.id === this.selectedComponentId) {
          return { ...c, position: { x: newX, y: newY } };
        }
        return c;
      });

      this.dataChanged.emit({ ...data, components });
    }

    // Dragging wire control point
    if (this.isDraggingControlPoint && this.draggedConnectionId) {
      const data = this.harnessData();
      if (!data) return;

      let newX = x;
      let newY = y;

      // Snap to grid
      if (this.snapToGrid()) {
        const grid = this.gridSize();
        newX = Math.round(newX / grid) * grid;
        newY = Math.round(newY / grid) * grid;
      }

      // Update the connection waypoints
      const connections = data.connections.map(conn => {
        if (conn.id === this.draggedConnectionId) {
          const fromPos = this.getConnectionFromPos(data, conn);
          const toPos = this.getConnectionToPos(data, conn);

          if (fromPos && toPos) {
            // Get current path points
            let currentPoints = conn.waypoints?.length
              ? [fromPos, ...conn.waypoints, toPos]
              : calculateOrthogonalPath(fromPos, toPos, this.gridSize());

            // Update the specific control point
            if (this.draggedControlPointIndex > 0 && this.draggedControlPointIndex < currentPoints.length - 1) {
              currentPoints[this.draggedControlPointIndex] = { x: newX, y: newY };

              // Extract waypoints (exclude start and end points which are from connectors)
              const newWaypoints = currentPoints.slice(1, -1);
              return { ...conn, waypoints: newWaypoints };
            }
          }
        }
        return conn;
      });

      this.dataChanged.emit({ ...data, connections });
      this.render();
      return;
    }

    // Dragging wire label
    if (this.isDraggingLabel && this.draggedLabelConnectionId) {
      const data = this.harnessData();
      if (!data) return;

      // Update the label position along the wire
      const connections = data.connections.map(conn => {
        if (conn.id === this.draggedLabelConnectionId) {
          const fromPos = this.getConnectionFromPos(data, conn);
          const toPos = this.getConnectionToPos(data, conn);

          if (fromPos && toPos) {
            const newPosition = getPositionFromPoint(conn, fromPos, toPos, x, y, this.gridSize());
            return { ...conn, labelPosition: newPosition };
          }
        }
        return conn;
      });

      this.dataChanged.emit({ ...data, connections });
      this.render();
      return;
    }

    // Update cursor based on what's under it
    if (!this.isDragging && !this.isDraggingCable && !this.isPanning && !this.isDrawingWire && !this.isDraggingControlPoint && !this.isDraggingLabel) {
      const data = this.harnessData();
      if (data) {
        let cursor = 'default';

        if (this.activeTool() === 'pan') {
          cursor = 'grab';
        } else if (this.activeTool() === 'wire') {
          // Check if over a connector pin
          for (const connector of data.connectors) {
            if (hitTestPin(connector, x, y)) {
              cursor = 'crosshair';
              break;
            }
          }
          // Check if over a cable wire endpoint
          if (cursor === 'default') {
            for (const cable of data.cables) {
              if (cable.position && hitTestCableWire(cable, x, y)) {
                cursor = 'crosshair';
                break;
              }
            }
          }
        } else {
          // Check if over a connector expand button first
          let found = false;
          for (const connector of data.connectors) {
            if (hitTestConnectorButton(connector, x, y)) {
              cursor = 'pointer';
              found = true;
              break;
            }
          }

          // Check if over a connector pin circle (for wire drawing)
          if (!found) {
            for (const connector of data.connectors) {
              if (hitTestPin(connector, x, y)) {
                cursor = 'crosshair';
                found = true;
                break;
              }
            }
          }

          // Check if over a cable wire endpoint (for wire drawing)
          if (!found) {
            for (const cable of data.cables) {
              if (cable.position && hitTestCableWire(cable, x, y)) {
                cursor = 'crosshair';
                found = true;
                break;
              }
            }
          }

          // Check if over a connector body (for dragging)
          if (!found) {
            for (const connector of data.connectors) {
              if (hitTestConnector(connector, x, y)) {
                cursor = 'move';
                found = true;
                break;
              }
            }
          }

          // Check if over a cable body (for dragging)
          if (!found) {
            for (const cable of data.cables) {
              if (cable.position && hitTestCable(cable, x, y)) {
                cursor = 'move';
                found = true;
                break;
              }
            }
          }

          // Check if over a component pin (for wire drawing)
          if (!found) {
            for (const component of (data.components || [])) {
              if (hitTestComponentPin(component, x, y)) {
                cursor = 'crosshair';
                found = true;
                break;
              }
            }
          }

          // Check if over a component body (for dragging)
          if (!found) {
            for (const component of (data.components || [])) {
              if (hitTestComponent(component, x, y)) {
                cursor = 'move';
                found = true;
                break;
              }
            }
          }

          // Check if over a wire label handle (if a wire is selected and has a label)
          if (!found && this.selectedConnectionId) {
            const selectedConnection = data.connections.find(c => c.id === this.selectedConnectionId);
            if (selectedConnection && selectedConnection.label) {
              const connFromPos = this.getConnectionFromPos(data, selectedConnection);
              const connToPos = this.getConnectionToPos(data, selectedConnection);
              if (connFromPos && connToPos) {
                if (hitTestWireLabelHandle(selectedConnection, connFromPos, connToPos, x, y, this.gridSize())) {
                  cursor = 'move';
                  found = true;
                }
              }
            }
          }

          // Check if over a wire control point (if a wire is selected)
          if (!found && this.selectedConnectionId) {
            const selectedConnection = data.connections.find(c => c.id === this.selectedConnectionId);
            if (selectedConnection) {
              const connFromPos = this.getConnectionFromPos(data, selectedConnection);
              const connToPos = this.getConnectionToPos(data, selectedConnection);
              if (connFromPos && connToPos) {
                const cpIndex = hitTestWireControlPoint(selectedConnection, connFromPos, connToPos, x, y, this.gridSize());
                if (cpIndex >= 0) {
                  cursor = 'move';
                  found = true;
                }
              }
            }
          }

          // Check if over a wire
          if (!found) {
            for (const connection of data.connections) {
              // Skip complex wire hit testing for now - the render function handles it
              if (connection.fromConnector && connection.toConnector) {
                const fromConnector = data.connectors.find(c => c.id === connection.fromConnector);
                const toConnector = data.connectors.find(c => c.id === connection.toConnector);

                if (fromConnector && toConnector) {
                  const fromPins = getConnectorPinPositions(fromConnector);
                  const toPins = getConnectorPinPositions(toConnector);
                  const fromPin = fromPins.find(p => p.pinId === connection.fromPin);
                  const toPin = toPins.find(p => p.pinId === connection.toPin);

                  if (fromPin && toPin && hitTestWire(connection, fromPin, toPin, x, y, this.gridSize())) {
                    cursor = 'pointer';
                    break;
                  }
                }
              }
            }
          }
        }

        this.canvasRef.nativeElement.style.cursor = cursor;
      }
    }
  }

  onMouseUp(event: MouseEvent) {
    // End panning
    if (this.isPanning) {
      this.isPanning = false;
      this.canvasRef.nativeElement.style.cursor = this.activeTool() === 'pan' ? 'grab' : 'default';
    }

    // End wire drawing
    if (this.isDrawingWire) {
      const { x, y } = this.screenToCanvas(event.clientX, event.clientY);
      const data = this.harnessData();

      if (data) {
        let connectionCreated = false;

        // Try to connect to a connector pin
        for (const connector of data.connectors) {
          // Don't connect to the same connector we started from
          if (this.wireStartConnectorId && connector.id === this.wireStartConnectorId) continue;

          const pinId = hitTestPin(connector, x, y);
          if (pinId) {
            // Create connection
            const newConnection: HarnessConnection = {
              id: `conn-${Date.now()}`,
              // From connector, cable, or component
              fromConnector: this.wireStartConnectorId || undefined,
              fromPin: this.wireStartPinId || undefined,
              fromCable: this.wireStartCableId || undefined,
              fromWire: this.wireStartWireId || undefined,
              fromSide: this.wireStartSide || undefined,
              fromComponent: this.wireStartComponentId || undefined,
              fromComponentPin: this.wireStartComponentPinId || undefined,
              // To connector
              toConnector: connector.id,
              toPin: pinId
            };

            // Normalize so from is always top-left
            const normalizedConnection = this.normalizeConnection(data, newConnection);

            this.dataChanged.emit({
              ...data,
              connections: [...data.connections, normalizedConnection]
            });
            connectionCreated = true;
            break;
          }
        }

        // Try to connect to a cable wire endpoint
        if (!connectionCreated) {
          for (const cable of data.cables) {
            if (!cable.position) continue;
            // Don't connect to the same cable wire we started from
            if (this.wireStartCableId && cable.id === this.wireStartCableId) continue;

            const hit = hitTestCableWire(cable, x, y);
            if (hit) {
              // Create connection
              const newConnection: HarnessConnection = {
                id: `conn-${Date.now()}`,
                // From connector, cable, or component
                fromConnector: this.wireStartConnectorId || undefined,
                fromPin: this.wireStartPinId || undefined,
                fromCable: this.wireStartCableId || undefined,
                fromWire: this.wireStartWireId || undefined,
                fromSide: this.wireStartSide || undefined,
                fromComponent: this.wireStartComponentId || undefined,
                fromComponentPin: this.wireStartComponentPinId || undefined,
                // To cable
                toCable: cable.id,
                toWire: hit.wireId,
                toSide: hit.side
              };

              // Normalize so from is always top-left
              const normalizedConnection = this.normalizeConnection(data, newConnection);

              this.dataChanged.emit({
                ...data,
                connections: [...data.connections, normalizedConnection]
              });
              connectionCreated = true;
              break;
            }
          }
        }

        // Try to connect to a component pin
        if (!connectionCreated) {
          for (const component of (data.components || [])) {
            // Don't connect to the same component we started from
            if (this.wireStartComponentId && component.id === this.wireStartComponentId) continue;

            const hit = hitTestComponentPin(component, x, y);
            if (hit) {
              // Create connection
              const newConnection: HarnessConnection = {
                id: `conn-${Date.now()}`,
                // From connector, cable, or component
                fromConnector: this.wireStartConnectorId || undefined,
                fromPin: this.wireStartPinId || undefined,
                fromCable: this.wireStartCableId || undefined,
                fromWire: this.wireStartWireId || undefined,
                fromSide: this.wireStartSide || undefined,
                fromComponent: this.wireStartComponentId || undefined,
                fromComponentPin: this.wireStartComponentPinId || undefined,
                // To component
                toComponent: component.id,
                toComponentPin: hit.pinId
              };

              // Normalize so from is always top-left
              const normalizedConnection = this.normalizeConnection(data, newConnection);

              this.dataChanged.emit({
                ...data,
                connections: [...data.connections, normalizedConnection]
              });
              break;
            }
          }
        }
      }

      this.isDrawingWire = false;
      this.wireStartConnectorId = null;
      this.wireStartPinId = null;
      this.wireStartCableId = null;
      this.wireStartWireId = null;
      this.wireStartSide = null;
      this.wireStartComponentId = null;
      this.wireStartComponentPinId = null;
      this.hoveredPinConnectorId = null;
      this.hoveredPinId = null;
      this.hoveredCableId = null;
      this.hoveredCableWireId = null;
      this.hoveredCableSide = null;
      this.hoveredComponentId = null;
      this.hoveredComponentPinId = null;
      this.render();
    }

    // End dragging connector
    if (this.isDragging) {
      this.isDragging = false;

      // Emit final position
      const data = this.harnessData();
      if (data && this.selectedConnectorId) {
        const connector = data.connectors.find(c => c.id === this.selectedConnectorId);
        if (connector) {
          this.connectorMoved.emit({
            connector,
            x: connector.position?.x || 0,
            y: connector.position?.y || 0
          });
        }
      }
    }

    // End dragging cable
    if (this.isDraggingCable) {
      this.isDraggingCable = false;

      // Emit final position
      const data = this.harnessData();
      if (data && this.selectedCableId) {
        const cable = data.cables.find(c => c.id === this.selectedCableId);
        if (cable && cable.position) {
          this.cableMoved.emit({
            cable,
            x: cable.position.x,
            y: cable.position.y
          });
        }
      }
    }

    // End dragging component
    if (this.isDraggingComponent) {
      this.isDraggingComponent = false;

      // Emit final position
      const data = this.harnessData();
      if (data && this.selectedComponentId) {
        const component = (data.components || []).find(c => c.id === this.selectedComponentId);
        if (component && component.position) {
          this.componentMoved.emit({
            component,
            x: component.position.x,
            y: component.position.y
          });
        }
      }
    }

    // End dragging control point
    if (this.isDraggingControlPoint) {
      this.isDraggingControlPoint = false;
      this.draggedConnectionId = null;
      this.draggedControlPointIndex = -1;
    }

    // End dragging label
    if (this.isDraggingLabel) {
      this.isDraggingLabel = false;
      this.draggedLabelConnectionId = null;
    }
  }

  onWheel(event: WheelEvent) {
    event.preventDefault();

    // Pan the canvas with scroll wheel
    this.panX -= event.deltaX;
    this.panY -= event.deltaY;

    this.render();
  }

  onDoubleClick(event: MouseEvent) {
    const { x, y } = this.screenToCanvas(event.clientX, event.clientY);
    const data = this.harnessData();
    if (!data) return;

    // Create sorted list by zIndex (highest first)
    type HitTestElement =
      | { type: 'connector'; element: typeof data.connectors[0] }
      | { type: 'cable'; element: typeof data.cables[0] }
      | { type: 'component'; element: HarnessComponent };

    const elements: HitTestElement[] = [
      ...data.connectors.map(c => ({ type: 'connector' as const, element: c })),
      ...data.cables.filter(c => c.position).map(c => ({ type: 'cable' as const, element: c })),
      ...(data.components || []).map(c => ({ type: 'component' as const, element: c }))
    ];
    elements.sort((a, b) => (b.element.zIndex || 0) - (a.element.zIndex || 0));

    for (const item of elements) {
      if (item.type === 'connector' && hitTestConnector(item.element, x, y)) {
        this.editConnector.emit(item.element);
        return;
      } else if (item.type === 'cable' && hitTestCable(item.element, x, y)) {
        this.editCable.emit(item.element);
        return;
      } else if (item.type === 'component' && hitTestComponent(item.element, x, y)) {
        this.editComponent.emit(item.element);
        return;
      }
    }
  }

  onContextMenu(event: MouseEvent) {
    event.preventDefault();
    const { x, y } = this.screenToCanvas(event.clientX, event.clientY);
    const data = this.harnessData();
    if (!data) return;

    // Create sorted list by zIndex (highest first)
    type HitTestElement =
      | { type: 'connector'; element: typeof data.connectors[0] }
      | { type: 'cable'; element: typeof data.cables[0] }
      | { type: 'component'; element: HarnessComponent };

    const elements: HitTestElement[] = [
      ...data.connectors.map(c => ({ type: 'connector' as const, element: c })),
      ...data.cables.filter(c => c.position).map(c => ({ type: 'cable' as const, element: c })),
      ...(data.components || []).map(c => ({ type: 'component' as const, element: c }))
    ];
    elements.sort((a, b) => (b.element.zIndex || 0) - (a.element.zIndex || 0));

    // Check what was right-clicked
    for (const item of elements) {
      if (item.type === 'connector' && hitTestConnector(item.element, x, y)) {
        // Select the connector
        this.selectedConnectorId = item.element.id;
        this.selectedCableId = null;
        this.selectedConnectionId = null;
        this.selectedComponentId = null;
        this.selectionChanged.emit({ type: 'connector', connector: item.element });
        this.contextMenuTarget = 'connector';
        this.showContextMenu(event);
        this.render();
        return;
      } else if (item.type === 'cable' && hitTestCable(item.element, x, y)) {
        // Select the cable
        this.selectedCableId = item.element.id;
        this.selectedConnectorId = null;
        this.selectedConnectionId = null;
        this.selectedComponentId = null;
        this.selectionChanged.emit({ type: 'cable', cable: item.element });
        this.contextMenuTarget = 'cable';
        this.showContextMenu(event);
        this.render();
        return;
      } else if (item.type === 'component' && hitTestComponent(item.element, x, y)) {
        // Select the component
        this.selectedComponentId = item.element.id;
        this.selectedConnectorId = null;
        this.selectedConnectionId = null;
        this.selectedCableId = null;
        this.selectionChanged.emit({ type: 'component', component: item.element });
        this.contextMenuTarget = 'component';
        this.showContextMenu(event);
        this.render();
        return;
      }
    }

    // No element hit - hide context menu
    this.hideContextMenu();
  }

  showContextMenu(event: MouseEvent) {
    const rect = this.canvasContainer.nativeElement.getBoundingClientRect();
    this.contextMenuX = event.clientX - rect.left;
    this.contextMenuY = event.clientY - rect.top;
    this.contextMenuVisible = true;
  }

  hideContextMenu() {
    this.contextMenuVisible = false;
    this.contextMenuTarget = null;
  }

  onContextMenuAction(action: string) {
    this.hideContextMenu();
    switch (action) {
      case 'rotate':
        this.rotateSelected.emit();
        break;
      case 'flip':
        this.flipSelected.emit();
        break;
      case 'bringToFront':
        this.bringToFront.emit();
        break;
      case 'moveForward':
        this.moveForward.emit();
        break;
      case 'moveBackward':
        this.moveBackward.emit();
        break;
      case 'sendToBack':
        this.sendToBack.emit();
        break;
      case 'delete':
        this.requestDelete.emit();
        break;
    }
  }

  // Public methods
  addConnector(connector: HarnessConnector) {
    const data = this.harnessData();
    if (!data) return;

    // Set position if not specified
    if (!connector.position) {
      connector.position = { x: 200, y: 200 };
    }

    this.dataChanged.emit({
      ...data,
      connectors: [...data.connectors, connector]
    });

    // Select the new connector
    this.selectedConnectorId = connector.id;
    this.selectedCableId = null;
    this.selectedConnectionId = null;
    this.selectedComponentId = null;
    this.selectionChanged.emit({ type: 'connector', connector });
    this.render();
  }

  deleteSelected() {
    const data = this.harnessData();
    if (!data) return;

    if (this.selectedConnectorId) {
      // Remove connector and its connections
      const connectors = data.connectors.filter(c => c.id !== this.selectedConnectorId);
      const connections = data.connections.filter(
        conn => conn.fromConnector !== this.selectedConnectorId &&
                conn.toConnector !== this.selectedConnectorId
      );

      this.selectedConnectorId = null;
      this.selectionChanged.emit({ type: 'none' });
      this.dataChanged.emit({ ...data, connectors, connections });
    } else if (this.selectedCableId) {
      // Remove cable and its connections
      const cables = data.cables.filter(c => c.id !== this.selectedCableId);
      const connections = data.connections.filter(
        conn => conn.fromCable !== this.selectedCableId &&
                conn.toCable !== this.selectedCableId
      );

      this.selectedCableId = null;
      this.selectionChanged.emit({ type: 'none' });
      this.dataChanged.emit({ ...data, cables, connections });
    } else if (this.selectedComponentId) {
      // Remove component and its connections
      const components = (data.components || []).filter(c => c.id !== this.selectedComponentId);
      const connections = data.connections.filter(
        conn => conn.fromComponent !== this.selectedComponentId &&
                conn.toComponent !== this.selectedComponentId
      );

      this.selectedComponentId = null;
      this.selectionChanged.emit({ type: 'none' });
      this.dataChanged.emit({ ...data, components, connections });
    } else if (this.selectedConnectionId) {
      const connections = data.connections.filter(c => c.id !== this.selectedConnectionId);
      this.selectedConnectionId = null;
      this.selectionChanged.emit({ type: 'none' });
      this.dataChanged.emit({ ...data, connections });
    }

    this.render();
  }

  addCable(cable: HarnessCable) {
    const data = this.harnessData();
    if (!data) return;

    // Set position if not specified
    if (!cable.position) {
      cable.position = { x: 300, y: 200 };
    }

    this.dataChanged.emit({
      ...data,
      cables: [...data.cables, cable]
    });

    // Select the new cable
    this.selectedCableId = cable.id;
    this.selectedConnectorId = null;
    this.selectedConnectionId = null;
    this.selectedComponentId = null;
    this.selectionChanged.emit({ type: 'cable', cable });
    this.render();
  }

  addComponent(component: HarnessComponent) {
    const data = this.harnessData();
    if (!data) return;

    // Set position if not specified
    if (!component.position) {
      component.position = { x: 400, y: 200 };
    }

    this.dataChanged.emit({
      ...data,
      components: [...(data.components || []), component]
    });

    // Select the new component
    this.selectedComponentId = component.id;
    this.selectedConnectorId = null;
    this.selectedConnectionId = null;
    this.selectedCableId = null;
    this.selectionChanged.emit({ type: 'component', component });
    this.render();
  }

  zoomIn() {
    const newZoom = Math.min(this.zoom() * 1.2, 5);
    this.zoom.set(newZoom);
    this.render();
  }

  zoomOut() {
    const newZoom = Math.max(this.zoom() * 0.8, 0.1);
    this.zoom.set(newZoom);
    this.render();
  }

  resetZoom() {
    this.zoom.set(1);
    this.panX = 0;
    this.panY = 0;
    this.render();
  }

  exportAsPNG(): string | null {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return null;
    return canvas.toDataURL('image/png');
  }

  exportAsThumbnail(): string | null {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return null;

    // Create a smaller canvas for thumbnail
    const thumbCanvas = document.createElement('canvas');
    const thumbCtx = thumbCanvas.getContext('2d');
    if (!thumbCtx) return null;

    const scale = 0.25;
    thumbCanvas.width = this.canvasWidth * scale;
    thumbCanvas.height = this.canvasHeight * scale;
    thumbCtx.scale(scale, scale);
    thumbCtx.drawImage(canvas, 0, 0);

    return thumbCanvas.toDataURL('image/png', 0.8);
  }

  // Helper to get connection from position
  private getConnectionFromPos(data: HarnessData, connection: HarnessConnection): { x: number; y: number } | null {
    if (connection.fromConnector && connection.fromPin) {
      const fromConnector = data.connectors.find(c => c.id === connection.fromConnector);
      if (fromConnector) {
        const pins = getConnectorPinPositions(fromConnector);
        const pin = pins.find(p => p.pinId === connection.fromPin);
        if (pin) return pin;
      }
    } else if (connection.fromCable && connection.fromWire && connection.fromSide) {
      const fromCable = data.cables.find(c => c.id === connection.fromCable);
      if (fromCable) {
        const wires = getCableWirePositions(fromCable);
        const wire = wires.find(w => w.wireId === connection.fromWire && w.side === connection.fromSide);
        if (wire) return wire;
      }
    } else if (connection.fromComponent && connection.fromComponentPin) {
      const fromComponent = (data.components || []).find(c => c.id === connection.fromComponent);
      if (fromComponent) {
        const pins = getComponentPinPositions(fromComponent);
        const pin = pins.find(p => p.pinId === connection.fromComponentPin);
        if (pin) return pin;
      }
    }
    return null;
  }

  // Helper to get connection to position
  private getConnectionToPos(data: HarnessData, connection: HarnessConnection): { x: number; y: number } | null {
    if (connection.toConnector && connection.toPin) {
      const toConnector = data.connectors.find(c => c.id === connection.toConnector);
      if (toConnector) {
        const pins = getConnectorPinPositions(toConnector);
        const pin = pins.find(p => p.pinId === connection.toPin);
        if (pin) return pin;
      }
    } else if (connection.toCable && connection.toWire && connection.toSide) {
      const toCable = data.cables.find(c => c.id === connection.toCable);
      if (toCable) {
        const wires = getCableWirePositions(toCable);
        const wire = wires.find(w => w.wireId === connection.toWire && w.side === connection.toSide);
        if (wire) return wire;
      }
    } else if (connection.toComponent && connection.toComponentPin) {
      const toComponent = (data.components || []).find(c => c.id === connection.toComponent);
      if (toComponent) {
        const pins = getComponentPinPositions(toComponent);
        const pin = pins.find(p => p.pinId === connection.toComponentPin);
        if (pin) return pin;
      }
    }
    return null;
  }

  // Normalize connection so "from" is always the top-left endpoint
  private normalizeConnection(data: HarnessData, connection: HarnessConnection): HarnessConnection {
    const fromPos = this.getConnectionFromPos(data, connection);
    const toPos = this.getConnectionToPos(data, connection);

    if (!fromPos || !toPos) return connection;

    // Compare positions: top-left is the one with smaller (x + y) value
    // If equal, prefer smaller x
    const fromScore = fromPos.x + fromPos.y;
    const toScore = toPos.x + toPos.y;

    const shouldSwap = toScore < fromScore || (toScore === fromScore && toPos.x < fromPos.x);

    if (shouldSwap) {
      // Swap from and to endpoints, and swap terminations
      return {
        ...connection,
        fromConnector: connection.toConnector,
        fromPin: connection.toPin,
        fromCable: connection.toCable,
        fromWire: connection.toWire,
        fromSide: connection.toSide,
        fromComponent: connection.toComponent,
        fromComponentPin: connection.toComponentPin,
        fromTermination: connection.toTermination,
        toConnector: connection.fromConnector,
        toPin: connection.fromPin,
        toCable: connection.fromCable,
        toWire: connection.fromWire,
        toSide: connection.fromSide,
        toComponent: connection.fromComponent,
        toComponentPin: connection.fromComponentPin,
        toTermination: connection.fromTermination,
        // Reverse waypoints if they exist
        waypoints: connection.waypoints ? [...connection.waypoints].reverse() : undefined
      };
    }

    return connection;
  }

  // Normalize all connections in the data
  normalizeAllConnections() {
    const data = this.harnessData();
    if (!data) return;

    const normalizedConnections = data.connections.map(conn => this.normalizeConnection(data, conn));

    // Only update if something changed
    const hasChanges = normalizedConnections.some((conn, i) =>
      conn.fromConnector !== data.connections[i].fromConnector ||
      conn.fromPin !== data.connections[i].fromPin ||
      conn.fromCable !== data.connections[i].fromCable ||
      conn.fromComponent !== data.connections[i].fromComponent
    );

    if (hasChanges) {
      this.dataChanged.emit({ ...data, connections: normalizedConnections });
    }
  }
}
