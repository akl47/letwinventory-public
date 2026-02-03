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
  HostListener,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  HarnessData,
  HarnessConnector,
  HarnessConnection,
  HarnessCable,
  HarnessComponent,
  SubHarnessRef,
  WireHarness,
} from '../../../models/harness.model';
import { HarnessService } from '../../../services/harness.service';
import {
  drawConnector,
  drawWire,
  drawWirePreview,
  drawMatingWirePreview,
  drawMatingConnection,
  drawGrid,
  drawCable,
  drawComponent,
  drawPinHighlight,
  hitTestConnector,
  hitTestPin,
  hitTestConnectorPinWithSide,
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
  getConnectorDimensions,
  getCableDimensions,
  getComponentDimensions,
  findWaypointInsertIndex,
  getNearestPointOnWire,
  WireObstacle,
} from '../../../utils/harness/canvas-renderer';
import {
  drawSubHarnessCollapsed,
  drawSubHarnessEditMode,
  SubHarnessEditState,
  hitTestSubHarness,
  hitTestSubHarnessPin,
  getSubHarnessPinPositions,
  getSubHarnessDimensions,
} from '../../../utils/harness/elements/sub-harness';
import { HarnessTool } from '../harness-toolbar/harness-toolbar';

export interface CanvasSelection {
  type: 'connector' | 'wire' | 'cable' | 'component' | 'subHarness' | 'multiple' | 'none';
  connector?: HarnessConnector;
  connection?: HarnessConnection;
  cable?: HarnessCable;
  component?: HarnessComponent;
  subHarness?: SubHarnessRef;
  // For multi-selection and grouping
  selectedIds?: { type: string; id: string }[];
  groupId?: string;  // If selected element belongs to a group
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
  private harnessService = inject(HarnessService);

  @ViewChild('canvasContainer') canvasContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('mainCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  // Inputs
  harnessData = input<HarnessData | null>(null);
  activeTool = input<string>('select');
  gridEnabled = input<boolean>(true);
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
  editChildConnector = output<{ connector: HarnessConnector; subHarnessId: number; childData: HarnessData }>();
  editChildCable = output<{ cable: HarnessCable; subHarnessId: number; childData: HarnessData }>();
  editChildComponent = output<{ component: HarnessComponent; subHarnessId: number; childData: HarnessData }>();
  bringToFront = output<void>();
  moveForward = output<void>();
  moveBackward = output<void>();
  sendToBack = output<void>();
  rotateSelected = output<void>();
  flipSelected = output<void>();
  requestDelete = output<void>();
  requestToolChange = output<string>();
  subHarnessDataChanged = output<{ subHarnessId: number; data: HarnessData }>();
  subHarnessEditModeChanged = output<boolean>();
  dragStart = output<void>();
  dragEnd = output<void>();

  // Context menu state
  contextMenuVisible = false;
  contextMenuX = 0;
  contextMenuY = 0;
  contextMenuTarget: 'connector' | 'cable' | 'component' | null = null;

  // Debug flag - set to true to show bounding boxes
  debugShowBounds = false;

  // Sub-harness edit mode state
  editingSubHarnessId = signal<string | null>(null);  // ID of sub-harness being edited
  private editingSubHarnessRef: SubHarnessRef | null = null;
  private editingChildHarness: WireHarness | null = null;

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
  private selectedSubHarnessId: string | null = null;
  // Multi-selection for grouping
  private selectedIds = new Set<string>();  // Format: "type:id" e.g., "connector:conn-1"
  private isDragging = false;
  private isDraggingCable = false;
  private isDraggingComponent = false;
  private isDraggingSubHarness = false;
  private isDraggingGroup = false;  // Dragging a grouped element
  private isDraggingMultiSelection = false;  // Dragging with multiple items selected
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  // Sub-harness data cache
  private subHarnessDataCache = new Map<number, WireHarness>();
  private loadingSubHarnesses = new Set<number>();

  // Panning state
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;

  // Marquee selection state
  private isMarqueeSelecting = false;
  private marqueeStartX = 0;
  private marqueeStartY = 0;
  private marqueeEndX = 0;
  private marqueeEndY = 0;

  // Wire drawing state
  private isDrawingWire = false;
  private isDrawingMatingWire = false;  // For mating pin to mating pin connections
  private wireStartConnectorId: string | null = null;
  private wireStartPinId: string | null = null;
  private wireStartCableId: string | null = null;
  private wireStartWireId: string | null = null;
  private wireStartSide: 'left' | 'right' | null = null;
  private wireStartComponentId: string | null = null;
  private wireStartComponentPinId: string | null = null;
  private wireStartSubHarnessId: string | null = null;
  private wireStartSubHarnessConnectorId: string | null = null;
  private wireEndX = 0;
  private wireEndY = 0;
  private hoveredPinConnectorId: string | null = null;
  private hoveredPinId: string | null = null;
  private hoveredMatingPinConnectorId: string | null = null;  // For mating pin hover
  private hoveredMatingPinId: string | null = null;
  private hoveredMatingSubHarnessId: string | null = null;  // For mating pin on subharness
  private hoveredMatingSubHarnessPinId: string | null = null;
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

  // Track if dragStart was emitted (for undo/redo)
  private dragStartEmitted = false;

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

  // Load sub-harness data for rendering
  private loadSubHarnessData(subHarnesses: SubHarnessRef[]): void {
    const idsToLoad = subHarnesses
      .map(s => s.harnessId)
      .filter(id => !this.subHarnessDataCache.has(id) && !this.loadingSubHarnesses.has(id));

    if (idsToLoad.length === 0) return;

    idsToLoad.forEach(id => this.loadingSubHarnesses.add(id));

    this.harnessService.getSubHarnessData(idsToLoad).subscribe({
      next: (harnesses) => {
        harnesses.forEach(h => {
          this.subHarnessDataCache.set(h.id, h);
          this.loadingSubHarnesses.delete(h.id);
        });
        this.render();
      },
      error: () => {
        idsToLoad.forEach(id => this.loadingSubHarnesses.delete(id));
      }
    });
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
      // Compute obstacles once for wire routing
      const wireObstacles = this.getWireObstacles();

      // Check if in sub-harness edit mode for wire drawing
      const inEditModeForWires = this.editingSubHarnessId() !== null;

      // Draw wires first (behind connectors and cables)
      // In edit mode, gray out parent harness wires
      if (inEditModeForWires) {
        ctx.globalAlpha = 0.3;
      }
      data.connections.forEach(connection => {
        let fromPos: { x: number; y: number } | null = null;
        let toPos: { x: number; y: number } | null = null;
        let wireColor = 'BK';
        const isMatingConnection = connection.connectionType === 'mating';

        // Get from position (connector pin, cable wire, or component pin)
        if (connection.fromConnector && connection.fromPin) {
          const fromConnector = data.connectors.find(c => c.id === connection.fromConnector);
          if (fromConnector) {
            // For mating connections, get mating pin position
            const pinSide = isMatingConnection ? 'mating' : 'wire';
            const fromPins = getConnectorPinPositions(fromConnector, pinSide);
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
        } else if (connection.fromSubHarness && connection.fromSubConnector && connection.fromPin) {
          const fromSubHarness = (data.subHarnesses || []).find(s => s.id === connection.fromSubHarness);
          if (fromSubHarness) {
            const childHarness = this.subHarnessDataCache.get(fromSubHarness.harnessId);
            const pinSide = isMatingConnection ? 'mating' : 'wire';
            const pins = getSubHarnessPinPositions(fromSubHarness, childHarness, pinSide);
            const pin = pins.find(p => p.connectorId === connection.fromSubConnector && p.connectorPinId === connection.fromPin);
            if (pin) fromPos = pin;
          }
        }

        // Get to position (connector pin, cable wire, or component pin)
        if (connection.toConnector && connection.toPin) {
          const toConnector = data.connectors.find(c => c.id === connection.toConnector);
          if (toConnector) {
            // For mating connections, get mating pin position
            const pinSide = isMatingConnection ? 'mating' : 'wire';
            const toPins = getConnectorPinPositions(toConnector, pinSide);
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
        } else if (connection.toSubHarness && connection.toSubConnector && connection.toPin) {
          const toSubHarness = (data.subHarnesses || []).find(s => s.id === connection.toSubHarness);
          if (toSubHarness) {
            const childHarness = this.subHarnessDataCache.get(toSubHarness.harnessId);
            const pinSide = isMatingConnection ? 'mating' : 'wire';
            const pins = getSubHarnessPinPositions(toSubHarness, childHarness, pinSide);
            const pin = pins.find(p => p.connectorId === connection.toSubConnector && p.connectorPinId === connection.toPin);
            if (pin) toPos = pin;
          }
        }

        // Draw the connection if we have both endpoints
        if (fromPos && toPos) {
          const isSelected = this.selectedConnectionId === connection.id || this.selectedIds.has(`connection:${connection.id}`);
          // Only show control points in nodeEdit mode when wire is selected
          const showControlPoints = this.activeTool() === 'nodeEdit' && isSelected;

          if (isMatingConnection) {
            // Draw mating connection as gray dashed orthogonal line
            drawMatingConnection(ctx, connection, fromPos, toPos, isSelected, this.gridSize(), wireObstacles, showControlPoints);
          } else {
            // Draw regular wire
            if (connection.color) {
              wireColor = connection.color;
            }
            drawWire(ctx, connection, fromPos, toPos, wireColor, isSelected, this.gridSize(), undefined, wireObstacles, showControlPoints);
          }
        }
      });

      // Reset alpha after drawing wires
      if (inEditModeForWires) {
        ctx.globalAlpha = 1.0;
      }

      // Preload any visible cable, connector, and component images
      this.preloadCableImages(data.cables);
      this.preloadConnectorImages(data.connectors);
      this.preloadComponentImages(data.components || []);

      // Load sub-harness data if any
      if (data.subHarnesses && data.subHarnesses.length > 0) {
        this.loadSubHarnessData(data.subHarnesses);
      }

      // Create a combined list of elements with their zIndex for sorting
      type DrawableElement =
        | { type: 'cable'; element: typeof data.cables[0] }
        | { type: 'connector'; element: typeof data.connectors[0] }
        | { type: 'component'; element: HarnessComponent }
        | { type: 'subHarness'; element: SubHarnessRef };

      const elements: DrawableElement[] = [
        ...data.cables.filter(c => c.position).map(cable => ({ type: 'cable' as const, element: cable })),
        ...data.connectors.map(connector => ({ type: 'connector' as const, element: connector })),
        ...(data.components || []).map(component => ({ type: 'component' as const, element: component })),
        ...(data.subHarnesses || []).map(subHarness => ({ type: 'subHarness' as const, element: subHarness }))
      ];

      // Sort by zIndex (lower values drawn first, appearing behind)
      elements.sort((a, b) => (a.element.zIndex || 0) - (b.element.zIndex || 0));

      // Check if in sub-harness edit mode
      const inEditMode = this.editingSubHarnessId() !== null;
      const editingId = this.editingSubHarnessId();

      // Draw all elements in zIndex order
      elements.forEach(item => {
        // In edit mode, gray out non-editing elements
        if (inEditMode && !(item.type === 'subHarness' && item.element.id === editingId)) {
          ctx.globalAlpha = 0.3;
        }

        if (item.type === 'cable') {
          const isSelected = !inEditMode && (this.selectedCableId === item.element.id || this.selectedIds.has(`cable:${item.element.id}`));
          drawCable(ctx, item.element, isSelected, this.loadedImages);
        } else if (item.type === 'connector') {
          const isSelected = !inEditMode && (this.selectedConnectorId === item.element.id || this.selectedIds.has(`connector:${item.element.id}`));
          drawConnector(ctx, item.element, isSelected, this.loadedImages);
        } else if (item.type === 'component') {
          const isSelected = !inEditMode && (this.selectedComponentId === item.element.id || this.selectedIds.has(`component:${item.element.id}`));
          drawComponent(ctx, item.element, isSelected, this.loadedImages);
        } else if (item.type === 'subHarness') {
          // In edit mode, don't draw the editing sub-harness with the standard function
          // We'll draw it separately with full editability
          if (inEditMode && item.element.id === editingId) {
            ctx.globalAlpha = 1.0;
            // Use editingChildHarness directly to ensure we have the same reference
            // that's being modified during drag operations
            const editState: SubHarnessEditState = {
              selectedConnectorId: this.selectedConnectorId,
              selectedCableId: this.selectedCableId,
              selectedComponentId: this.selectedComponentId,
              selectedConnectionId: this.selectedConnectionId,
              isNodeEditMode: this.activeTool() === 'nodeEdit'
            };
            drawSubHarnessEditMode(ctx, item.element, this.editingChildHarness!, editState, this.loadedImages);
          } else {
            const isSelected = !inEditMode && (this.selectedSubHarnessId === item.element.id || this.selectedIds.has(`subHarness:${item.element.id}`));
            const childHarness = this.subHarnessDataCache.get(item.element.harnessId);
            drawSubHarnessCollapsed(ctx, item.element, childHarness, isSelected, this.loadedImages);
          }
        }

        // Reset alpha
        ctx.globalAlpha = 1.0;
      });

      // In edit mode, draw an overlay hint and edit mode indicator
      if (inEditMode && this.editingSubHarnessRef && this.editingChildHarness) {
        this.drawSubHarnessEditModeOverlay(ctx);
      }

      // Draw group border if a grouped item is selected
      const selectedGroupId = this.getSelectedGroupId();
      if (selectedGroupId) {
        this.drawGroupBorder(ctx, selectedGroupId);
      }

      // Draw wire preview if drawing
      if (this.isDrawingWire) {
        let startX = this.wireEndX;
        let startY = this.wireEndY;
        let startPinPos: { x: number; y: number } | null = null;

        if (this.wireStartConnectorId && this.wireStartPinId) {
          const startConnector = data.connectors.find(c => c.id === this.wireStartConnectorId);
          if (startConnector) {
            // Get pins from the correct side based on whether we're drawing a mating wire
            const pinSide = this.isDrawingMatingWire ? 'mating' : 'wire';
            const pins = getConnectorPinPositions(startConnector, pinSide);
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
        } else if (this.wireStartSubHarnessId && this.wireStartSubHarnessConnectorId && this.wireStartPinId) {
          const startSubHarness = (data.subHarnesses || []).find(s => s.id === this.wireStartSubHarnessId);
          if (startSubHarness) {
            const childHarness = this.subHarnessDataCache.get(startSubHarness.harnessId);
            const pinSide = this.isDrawingMatingWire ? 'mating' : 'wire';
            const pins = getSubHarnessPinPositions(startSubHarness, childHarness, pinSide);
            const startPin = pins.find(p => p.connectorId === this.wireStartSubHarnessConnectorId && p.connectorPinId === this.wireStartPinId);
            if (startPin) {
              startX = startPin.x;
              startY = startPin.y;
              startPinPos = startPin;
            }
          }
        }

        if (startX !== this.wireEndX || startY !== this.wireEndY) {
          // Use different preview for mating wire vs regular wire
          if (this.isDrawingMatingWire) {
            drawMatingWirePreview(ctx, startX, startY, this.wireEndX, this.wireEndY, this.gridSize(), wireObstacles);
          } else {
            drawWirePreview(ctx, startX, startY, this.wireEndX, this.wireEndY, this.gridSize(), wireObstacles);
          }
        }

        // Draw green highlight on start pin (connector, cable, or component)
        if (startPinPos) {
          drawPinHighlight(ctx, startPinPos.x, startPinPos.y, true);
        }

        // Draw green highlight on hovered end pin (connector) - for regular wires
        if (!this.isDrawingMatingWire && this.hoveredPinConnectorId && this.hoveredPinId) {
          const hoveredConnector = data.connectors.find(c => c.id === this.hoveredPinConnectorId);
          if (hoveredConnector) {
            const pins = getConnectorPinPositions(hoveredConnector);
            const hoveredPin = pins.find(p => p.pinId === this.hoveredPinId);
            if (hoveredPin) {
              drawPinHighlight(ctx, hoveredPin.x, hoveredPin.y, false);
            }
          }
        }

        // Draw green highlight on hovered mating pin - for mating wires
        if (this.isDrawingMatingWire && this.hoveredMatingPinConnectorId && this.hoveredMatingPinId) {
          const hoveredConnector = data.connectors.find(c => c.id === this.hoveredMatingPinConnectorId);
          if (hoveredConnector) {
            const pins = getConnectorPinPositions(hoveredConnector, 'mating');
            const hoveredPin = pins.find(p => p.pinId === this.hoveredMatingPinId);
            if (hoveredPin) {
              drawPinHighlight(ctx, hoveredPin.x, hoveredPin.y, false);
            }
          }
        }

        // Draw green highlight on hovered subharness mating pin - for mating wires
        if (this.isDrawingMatingWire && this.hoveredMatingSubHarnessId && this.hoveredMatingSubHarnessPinId) {
          const hoveredSubHarness = (data.subHarnesses || []).find(s => s.id === this.hoveredMatingSubHarnessId);
          if (hoveredSubHarness) {
            const childHarness = this.subHarnessDataCache.get(hoveredSubHarness.harnessId);
            const pins = getSubHarnessPinPositions(hoveredSubHarness, childHarness, 'mating');
            const hoveredPin = pins.find(p => p.pinId === this.hoveredMatingSubHarnessPinId);
            if (hoveredPin) {
              drawPinHighlight(ctx, hoveredPin.x, hoveredPin.y, false);
            }
          }
        }

        // Draw green highlight on hovered end pin (cable wire) - only for regular wires
        if (!this.isDrawingMatingWire && this.hoveredCableId && this.hoveredCableWireId && this.hoveredCableSide) {
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

    // DEBUG: Draw bounding boxes in real-time
    if (this.debugShowBounds && data) {
      const ROW_HEIGHT = 20;
      const CABLE_WIRE_SPACING = 20;
      ctx.lineWidth = 2 / this.zoom();

      // Helper to rotate a point around origin and translate
      const transformPoint = (localX: number, localY: number, originX: number, originY: number, rotation: number) => {
        const rad = (rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        return {
          x: originX + localX * cos - localY * sin,
          y: originY + localX * sin + localY * cos
        };
      };

      // Helper to get axis-aligned bounds from rotated corners
      const getRotatedBounds = (localMinX: number, localMinY: number, localMaxX: number, localMaxY: number,
                                 originX: number, originY: number, rotation: number) => {
        const corners = [
          transformPoint(localMinX, localMinY, originX, originY, rotation),
          transformPoint(localMaxX, localMinY, originX, originY, rotation),
          transformPoint(localMaxX, localMaxY, originX, originY, rotation),
          transformPoint(localMinX, localMaxY, originX, originY, rotation)
        ];
        return {
          minX: Math.min(...corners.map(c => c.x)),
          minY: Math.min(...corners.map(c => c.y)),
          maxX: Math.max(...corners.map(c => c.x)),
          maxY: Math.max(...corners.map(c => c.y))
        };
      };

      // Connector bounds (red)
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
      for (const connector of data.connectors) {
        if (!connector.position) continue;
        const dims = getConnectorDimensions(connector);
        const pinCount = connector.pins?.length || connector.pinCount || 1;
        const headerAndExtras = dims.height - (pinCount * ROW_HEIGHT);
        const rotation = connector.rotation || 0;
        // Origin is at (x, y - ROW_HEIGHT/2), local coords relative to that
        const originX = connector.position.x;
        const originY = connector.position.y - ROW_HEIGHT / 2;
        const localMinX = 0;
        const localMinY = -headerAndExtras;
        const localMaxX = dims.width;
        const localMaxY = pinCount * ROW_HEIGHT;
        const bounds = getRotatedBounds(localMinX, localMinY, localMaxX, localMaxY, originX, originY, rotation);
        ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      }

      // Cable bounds (green)
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
      for (const cable of data.cables) {
        if (!cable.position) continue;
        const dims = getCableDimensions(cable);
        const wireCount = cable.wires?.length || cable.wireCount || 1;
        const headerAndExtras = dims.height - (wireCount * CABLE_WIRE_SPACING);
        const rotation = cable.rotation || 0;
        // Origin is at (x, y), local coords relative to that
        const originX = cable.position.x;
        const originY = cable.position.y;
        const localMinX = 0;
        const localMinY = -headerAndExtras - CABLE_WIRE_SPACING / 2;
        const localMaxX = dims.width;
        const localMaxY = (wireCount - 0.5) * CABLE_WIRE_SPACING;
        const bounds = getRotatedBounds(localMinX, localMinY, localMaxX, localMaxY, originX, originY, rotation);
        ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      }

      // Component bounds (blue)
      ctx.strokeStyle = 'rgba(0, 0, 255, 0.8)';
      for (const component of (data.components || [])) {
        if (!component.position) continue;
        const dims = getComponentDimensions(component);
        let totalPins = 0;
        for (const group of component.pinGroups || []) {
          totalPins += group.pins?.length || 0;
        }
        totalPins = Math.max(totalPins, 1);
        const headerAndExtras = dims.height - (totalPins * ROW_HEIGHT);
        const rotation = component.rotation || 0;
        // Origin is at (x, y - ROW_HEIGHT/2), local coords relative to that
        const originX = component.position.x;
        const originY = component.position.y - ROW_HEIGHT / 2;
        const localMinX = 0;
        const localMinY = -headerAndExtras;
        const localMaxX = dims.width;
        const localMaxY = totalPins * ROW_HEIGHT;
        const bounds = getRotatedBounds(localMinX, localMinY, localMaxX, localMaxY, originX, originY, rotation);
        ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      }

      // Sub-harness bounds (magenta)
      ctx.strokeStyle = 'rgba(255, 0, 255, 0.8)';
      for (const subHarness of (data.subHarnesses || [])) {
        if (!subHarness.position) continue;
        const childHarness = this.subHarnessDataCache.get(subHarness.harnessId);
        const dims = getSubHarnessDimensions(subHarness, childHarness);
        const rotation = subHarness.rotation || 0;
        // Origin is at (x, y), local bounds from dims
        const originX = subHarness.position.x;
        const originY = subHarness.position.y;
        const bounds = getRotatedBounds(dims.bounds.minX, dims.bounds.minY, dims.bounds.maxX, dims.bounds.maxY, originX, originY, rotation);
        ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      }

      // Wire bounds (cyan)
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
      const debugWireObstacles = this.getWireObstacles();
      for (const connection of data.connections) {
        const fromPos = this.getConnectionFromPos(data, connection);
        const toPos = this.getConnectionToPos(data, connection);
        if (!fromPos || !toPos) continue;

        // Get all path points - either stored waypoints or calculated orthogonal path
        const pathPoints = connection.waypoints?.length
          ? [fromPos, ...connection.waypoints, toPos]
          : calculateOrthogonalPath(fromPos, toPos, this.gridSize(), debugWireObstacles);

        let wMinX = Infinity;
        let wMinY = Infinity;
        let wMaxX = -Infinity;
        let wMaxY = -Infinity;

        for (const pt of pathPoints) {
          wMinX = Math.min(wMinX, pt.x);
          wMinY = Math.min(wMinY, pt.y);
          wMaxX = Math.max(wMaxX, pt.x);
          wMaxY = Math.max(wMaxY, pt.y);
        }

        ctx.strokeRect(wMinX - 2, wMinY - 2, wMaxX - wMinX + 4, wMaxY - wMinY + 4);

        // Draw circles at endpoints
        ctx.fillStyle = 'rgba(0, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(fromPos.x, fromPos.y, 4 / this.zoom(), 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(toPos.x, toPos.y, 4 / this.zoom(), 0, Math.PI * 2);
        ctx.fill();

        // Draw squares at intermediate path points (waypoints)
        const s = 6 / this.zoom();
        for (let i = 1; i < pathPoints.length - 1; i++) {
          const pt = pathPoints[i];
          ctx.fillRect(pt.x - s/2, pt.y - s/2, s, s);
        }
      }
    }

    // Draw marquee selection rectangle
    if (this.isMarqueeSelecting) {
      const minX = Math.min(this.marqueeStartX, this.marqueeEndX);
      const minY = Math.min(this.marqueeStartY, this.marqueeEndY);
      const width = Math.abs(this.marqueeEndX - this.marqueeStartX);
      const height = Math.abs(this.marqueeEndY - this.marqueeStartY);

      ctx.strokeStyle = '#2196f3';
      ctx.lineWidth = 1 / this.zoom();
      ctx.setLineDash([5 / this.zoom(), 3 / this.zoom()]);
      ctx.strokeRect(minX, minY, width, height);

      ctx.fillStyle = 'rgba(33, 150, 243, 0.1)';
      ctx.fillRect(minX, minY, width, height);
      ctx.setLineDash([]);
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

    // Middle mouse button for panning (always allowed)
    if (event.button === 1 || this.activeTool() === 'pan') {
      this.isPanning = true;
      this.panStartX = event.clientX - this.panX;
      this.panStartY = event.clientY - this.panY;
      this.canvasRef.nativeElement.style.cursor = 'grabbing';
      return;
    }

    // Handle sub-harness edit mode
    if (this.editingSubHarnessId() && this.editingSubHarnessRef && this.editingChildHarness) {
      this.handleSubHarnessEditModeMouseDown(event, x, y);
      return;
    }

    // Wire drawing tool - check connector pins, cable wire endpoints, and component pins
    if (this.activeTool() === 'wire') {
      // Check connector pins first (including mating pins)
      for (const connector of data.connectors) {
        const pinHit = hitTestConnectorPinWithSide(connector, x, y);
        if (pinHit) {
          this.isDrawingWire = true;
          this.isDrawingMatingWire = pinHit.side === 'mating';
          this.wireStartConnectorId = connector.id;
          this.wireStartPinId = pinHit.pinId;
          this.wireStartCableId = null;
          this.wireStartWireId = null;
          this.wireStartSide = null;
          this.wireStartComponentId = null;
          this.wireStartComponentPinId = null;
          this.wireStartSubHarnessId = null;
          this.wireStartSubHarnessConnectorId = null;
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
          this.wireStartSubHarnessId = null;
          this.wireStartSubHarnessConnectorId = null;
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
          this.wireStartSubHarnessId = null;
          this.wireStartSubHarnessConnectorId = null;
          this.wireEndX = x;
          this.wireEndY = y;
          return;
        }
      }
      // Check subharness pins (both wire and mating sides)
      for (const subHarness of (data.subHarnesses || [])) {
        const childHarness = this.subHarnessDataCache.get(subHarness.harnessId);
        // Check mating pins first
        const matingPinHit = hitTestSubHarnessPin(subHarness, childHarness, x, y, 'mating');
        if (matingPinHit) {
          this.isDrawingWire = true;
          this.isDrawingMatingWire = true;
          this.wireStartSubHarnessId = subHarness.id;
          this.wireStartSubHarnessConnectorId = matingPinHit.connectorId;
          this.wireStartPinId = matingPinHit.connectorPinId;
          this.wireStartConnectorId = null;
          this.wireStartCableId = null;
          this.wireStartWireId = null;
          this.wireStartSide = null;
          this.wireStartComponentId = null;
          this.wireStartComponentPinId = null;
          this.wireEndX = x;
          this.wireEndY = y;
          return;
        }
        // Check wire pins
        const wirePinHit = hitTestSubHarnessPin(subHarness, childHarness, x, y, 'wire');
        if (wirePinHit) {
          this.isDrawingWire = true;
          this.isDrawingMatingWire = false;
          this.wireStartSubHarnessId = subHarness.id;
          this.wireStartSubHarnessConnectorId = wirePinHit.connectorId;
          this.wireStartPinId = wirePinHit.connectorPinId;
          this.wireStartConnectorId = null;
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
      return;
    }

    // Node Edit tool - click on control points to drag them
    if (this.activeTool() === 'nodeEdit') {
      // Check all wires (including mating connections) for control point hits
      for (const connection of data.connections) {
        const fromPos = this.getConnectionFromPos(data, connection);
        const toPos = this.getConnectionToPos(data, connection);
        if (!fromPos || !toPos) continue;

        const cpIndex = hitTestWireControlPoint(connection, fromPos, toPos, x, y, this.gridSize());
        if (cpIndex >= 0) {
          // Start dragging this control point
          this.isDraggingControlPoint = true;
          this.draggedConnectionId = connection.id;
          this.draggedControlPointIndex = cpIndex;
          this.selectedConnectionId = connection.id;
          this.emitDragStartOnce();
          this.selectionChanged.emit({ type: 'wire', connection });
          return;
        }
      }
      // If not clicking on a control point, select the wire if clicking on it
      for (const connection of data.connections) {
        const fromPos = this.getConnectionFromPos(data, connection);
        const toPos = this.getConnectionToPos(data, connection);
        if (!fromPos || !toPos) continue;

        if (hitTestWire(connection, fromPos, toPos, x, y, this.gridSize())) {
          this.selectedConnectionId = connection.id;
          this.selectedConnectorId = null;
          this.selectedCableId = null;
          this.selectedComponentId = null;
          this.selectedSubHarnessId = null;
          this.selectionChanged.emit({ type: 'wire', connection });
          return;
        }
      }
      // Clicked on nothing - clear selection
      this.clearSelection();
      this.selectionChanged.emit({ type: 'none' });
      return;
    }

    // Select tool
    // First check if clicking on a connector pin circle or mating point (to start wire drawing)
    for (const connector of data.connectors) {
      const pinHit = hitTestConnectorPinWithSide(connector, x, y);
      if (pinHit) {
        this.isDrawingWire = true;
        this.isDrawingMatingWire = pinHit.side === 'mating';
        this.wireStartConnectorId = connector.id;
        this.wireStartPinId = pinHit.pinId;
        this.wireStartCableId = null;
        this.wireStartWireId = null;
        this.wireStartSide = null;
        this.wireStartComponentId = null;
        this.wireStartComponentPinId = null;
        this.wireStartSubHarnessId = null;
        this.wireStartSubHarnessConnectorId = null;
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
        this.wireStartSubHarnessId = null;
        this.wireStartSubHarnessConnectorId = null;
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
        this.wireStartSubHarnessId = null;
        this.wireStartSubHarnessConnectorId = null;
        this.wireEndX = x;
        this.wireEndY = y;
        return;
      }
    }

    // Check subharness pins (to start wire drawing)
    for (const subHarness of (data.subHarnesses || [])) {
      const childHarness = this.subHarnessDataCache.get(subHarness.harnessId);
      // Check mating pins first
      const matingPinHit = hitTestSubHarnessPin(subHarness, childHarness, x, y, 'mating');
      if (matingPinHit) {
        this.isDrawingWire = true;
        this.isDrawingMatingWire = true;
        this.wireStartSubHarnessId = subHarness.id;
        this.wireStartSubHarnessConnectorId = matingPinHit.connectorId;
        this.wireStartPinId = matingPinHit.connectorPinId;
        this.wireStartConnectorId = null;
        this.wireStartCableId = null;
        this.wireStartWireId = null;
        this.wireStartSide = null;
        this.wireStartComponentId = null;
        this.wireStartComponentPinId = null;
        this.wireEndX = x;
        this.wireEndY = y;
        return;
      }
      // Check wire pins
      const wirePinHit = hitTestSubHarnessPin(subHarness, childHarness, x, y, 'wire');
      if (wirePinHit) {
        this.isDrawingWire = true;
        this.isDrawingMatingWire = false;
        this.wireStartSubHarnessId = subHarness.id;
        this.wireStartSubHarnessConnectorId = wirePinHit.connectorId;
        this.wireStartPinId = wirePinHit.connectorPinId;
        this.wireStartConnectorId = null;
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

    // Create sorted list of all elements by zIndex (highest first for hit testing)
    type HitTestElement =
      | { type: 'connector'; element: typeof data.connectors[0] }
      | { type: 'cable'; element: typeof data.cables[0] }
      | { type: 'component'; element: HarnessComponent }
      | { type: 'subHarness'; element: SubHarnessRef };

    const elements: HitTestElement[] = [
      ...data.connectors.map(c => ({ type: 'connector' as const, element: c })),
      ...data.cables.filter(c => c.position).map(c => ({ type: 'cable' as const, element: c })),
      ...(data.components || []).map(c => ({ type: 'component' as const, element: c })),
      ...(data.subHarnesses || []).map(c => ({ type: 'subHarness' as const, element: c }))
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
          // Handle shift-click for multi-selection
          const alreadySelected = this.selectedIds.has(`connector:${item.element.id}`);
          if (event.shiftKey) {
            // Toggle selection on shift-click
            if (alreadySelected) {
              this.removeFromSelection('connector', item.element.id);
              // If this was the primary selection, clear it
              if (this.selectedConnectorId === item.element.id) {
                this.selectedConnectorId = null;
              }
              this.selectionChanged.emit({
                type: this.selectedIds.size > 0 ? 'connector' : 'none',
                selectedIds: Array.from(this.selectedIds).map(s => {
                  const [type, id] = s.split(':');
                  return { type, id };
                })
              });
              this.render();
              return;
            } else {
              this.addToSelection('connector', item.element.id);
            }
          } else if (!alreadySelected) {
            // Only clear selection if clicking on an unselected item
            this.clearMultiSelection();
            this.addToSelection('connector', item.element.id);
            // If item is in a group, select all group members
            if (item.element.groupId) {
              this.selectGroupMembers(item.element.groupId);
            }
          }

          this.selectedConnectorId = item.element.id;
          this.selectedConnectionId = null;
          this.selectedCableId = null;
          this.selectedComponentId = null;
          this.selectedSubHarnessId = null;
          this.isDragging = true;
          this.isDraggingCable = false;
          this.isDraggingComponent = false;
          this.isDraggingSubHarness = false;
          this.isDraggingGroup = !!item.element.groupId;
          this.isDraggingMultiSelection = this.selectedIds.size > 1;
          this.dragStartX = x;
          this.dragStartY = y;
          this.dragOffsetX = x - (item.element.position?.x || 0);
          this.dragOffsetY = y - (item.element.position?.y || 0);
          this.emitDragStartOnce();

          this.selectionChanged.emit({
            type: 'connector',
            connector: item.element,
            groupId: item.element.groupId,
            selectedIds: Array.from(this.selectedIds).map(s => {
              const [type, id] = s.split(':');
              return { type, id };
            })
          });
          this.render();
          return;
        }
      } else if (item.type === 'cable') {
        if (hitTestCable(item.element, x, y)) {
          // Handle shift-click for multi-selection
          const alreadySelected = this.selectedIds.has(`cable:${item.element.id}`);
          if (event.shiftKey) {
            // Toggle selection on shift-click
            if (alreadySelected) {
              this.removeFromSelection('cable', item.element.id);
              if (this.selectedCableId === item.element.id) {
                this.selectedCableId = null;
              }
              this.selectionChanged.emit({
                type: this.selectedIds.size > 0 ? 'cable' : 'none',
                selectedIds: Array.from(this.selectedIds).map(s => {
                  const [type, id] = s.split(':');
                  return { type, id };
                })
              });
              this.render();
              return;
            } else {
              this.addToSelection('cable', item.element.id);
            }
          } else if (!alreadySelected) {
            this.clearMultiSelection();
            this.addToSelection('cable', item.element.id);
            // If item is in a group, select all group members
            if (item.element.groupId) {
              this.selectGroupMembers(item.element.groupId);
            }
          }

          this.selectedCableId = item.element.id;
          this.selectedConnectorId = null;
          this.selectedConnectionId = null;
          this.selectedComponentId = null;
          this.selectedSubHarnessId = null;
          this.isDragging = false;
          this.isDraggingCable = true;
          this.isDraggingComponent = false;
          this.isDraggingSubHarness = false;
          this.isDraggingGroup = !!item.element.groupId;
          this.isDraggingMultiSelection = this.selectedIds.size > 1;
          this.dragStartX = x;
          this.dragStartY = y;
          this.dragOffsetX = x - (item.element.position?.x || 0);
          this.dragOffsetY = y - (item.element.position?.y || 0);
          this.emitDragStartOnce();

          this.selectionChanged.emit({
            type: 'cable',
            cable: item.element,
            groupId: item.element.groupId,
            selectedIds: Array.from(this.selectedIds).map(s => {
              const [type, id] = s.split(':');
              return { type, id };
            })
          });
          this.render();
          return;
        }
      } else if (item.type === 'component') {
        if (hitTestComponent(item.element, x, y)) {
          // Handle shift-click for multi-selection
          const alreadySelected = this.selectedIds.has(`component:${item.element.id}`);
          if (event.shiftKey) {
            // Toggle selection on shift-click
            if (alreadySelected) {
              this.removeFromSelection('component', item.element.id);
              if (this.selectedComponentId === item.element.id) {
                this.selectedComponentId = null;
              }
              this.selectionChanged.emit({
                type: this.selectedIds.size > 0 ? 'component' : 'none',
                selectedIds: Array.from(this.selectedIds).map(s => {
                  const [type, id] = s.split(':');
                  return { type, id };
                })
              });
              this.render();
              return;
            } else {
              this.addToSelection('component', item.element.id);
            }
          } else if (!alreadySelected) {
            this.clearMultiSelection();
            this.addToSelection('component', item.element.id);
            // If item is in a group, select all group members
            if (item.element.groupId) {
              this.selectGroupMembers(item.element.groupId);
            }
          }

          this.selectedComponentId = item.element.id;
          this.selectedConnectorId = null;
          this.selectedConnectionId = null;
          this.selectedCableId = null;
          this.selectedSubHarnessId = null;
          this.isDragging = false;
          this.isDraggingCable = false;
          this.isDraggingComponent = true;
          this.isDraggingSubHarness = false;
          this.isDraggingGroup = !!item.element.groupId;
          this.isDraggingMultiSelection = this.selectedIds.size > 1;
          this.dragStartX = x;
          this.dragStartY = y;
          this.dragOffsetX = x - (item.element.position?.x || 0);
          this.dragOffsetY = y - (item.element.position?.y || 0);
          this.emitDragStartOnce();

          this.selectionChanged.emit({
            type: 'component',
            component: item.element,
            groupId: item.element.groupId,
            selectedIds: Array.from(this.selectedIds).map(s => {
              const [type, id] = s.split(':');
              return { type, id };
            })
          });
          this.render();
          return;
        }
      } else if (item.type === 'subHarness') {
        const childHarness = this.subHarnessDataCache.get(item.element.harnessId);
        if (hitTestSubHarness(item.element, childHarness, x, y)) {
          // Handle shift-click for multi-selection
          const alreadySelected = this.selectedIds.has(`subHarness:${item.element.id}`);
          if (event.shiftKey) {
            // Toggle selection on shift-click
            if (alreadySelected) {
              this.removeFromSelection('subHarness', item.element.id);
              if (this.selectedSubHarnessId === item.element.id) {
                this.selectedSubHarnessId = null;
              }
              this.selectionChanged.emit({
                type: this.selectedIds.size > 0 ? 'subHarness' : 'none',
                selectedIds: Array.from(this.selectedIds).map(s => {
                  const [type, id] = s.split(':');
                  return { type, id };
                })
              });
              this.render();
              return;
            } else {
              this.addToSelection('subHarness', item.element.id);
            }
          } else if (!alreadySelected) {
            this.clearMultiSelection();
            this.addToSelection('subHarness', item.element.id);
            // If item is in a group, select all group members
            if (item.element.groupId) {
              this.selectGroupMembers(item.element.groupId);
            }
          }

          this.selectedSubHarnessId = item.element.id;
          this.selectedConnectorId = null;
          this.selectedConnectionId = null;
          this.selectedCableId = null;
          this.selectedComponentId = null;
          this.isDragging = false;
          this.isDraggingCable = false;
          this.isDraggingComponent = false;
          this.isDraggingSubHarness = true;
          this.isDraggingGroup = !!item.element.groupId;
          this.isDraggingMultiSelection = this.selectedIds.size > 1;
          this.dragStartX = x;
          this.dragStartY = y;
          this.dragOffsetX = x - (item.element.position?.x || 0);
          this.dragOffsetY = y - (item.element.position?.y || 0);
          this.emitDragStartOnce();

          this.selectionChanged.emit({
            type: 'subHarness',
            subHarness: item.element,
            groupId: item.element.groupId,
            selectedIds: Array.from(this.selectedIds).map(s => {
              const [type, id] = s.split(':');
              return { type, id };
            })
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
            this.emitDragStartOnce();
            return;
          }
        }
      }
    }

    // Check for wire control point hit (if a wire is selected)
    // Only allow control point dragging in nodeEdit mode
    if (this.activeTool() === 'nodeEdit' && this.selectedConnectionId) {
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
            this.emitDragStartOnce();
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
        // Handle shift-click for multi-selection
        const alreadySelected = this.selectedIds.has(`connection:${connection.id}`);
        if (event.shiftKey) {
          // Toggle selection on shift-click
          if (alreadySelected) {
            this.removeFromSelection('connection', connection.id);
            if (this.selectedConnectionId === connection.id) {
              this.selectedConnectionId = null;
            }
            this.selectionChanged.emit({
              type: this.selectedIds.size > 0 ? 'wire' : 'none',
              selectedIds: Array.from(this.selectedIds).map(s => {
                const [type, id] = s.split(':');
                return { type, id };
              })
            });
            this.render();
            return;
          } else {
            this.addToSelection('connection', connection.id);
          }
        } else if (!alreadySelected) {
          this.clearMultiSelection();
          this.addToSelection('connection', connection.id);
        }

        this.selectedConnectionId = connection.id;
        this.selectedConnectorId = null;
        this.selectedCableId = null;
        this.selectedComponentId = null;
        this.selectedSubHarnessId = null;
        this.selectionChanged.emit({
          type: 'wire',
          connection: connection,
          selectedIds: Array.from(this.selectedIds).map(s => {
            const [type, id] = s.split(':');
            return { type, id };
          })
        });
        this.render();
        return;
      }
    }

    // Clicked on empty space - start marquee selection
    if (!event.shiftKey) {
      // Clear existing selection when starting new marquee
      this.selectedConnectorId = null;
      this.selectedConnectionId = null;
      this.selectedCableId = null;
      this.selectedComponentId = null;
      this.selectedSubHarnessId = null;
      this.clearMultiSelection();
    }

    // Start marquee selection
    this.isMarqueeSelecting = true;
    this.marqueeStartX = x;
    this.marqueeStartY = y;
    this.marqueeEndX = x;
    this.marqueeEndY = y;

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

    // Marquee selection
    if (this.isMarqueeSelecting) {
      this.marqueeEndX = x;
      this.marqueeEndY = y;
      this.render();
      return;
    }

    // Handle sub-harness edit mode mouse move
    if (this.editingSubHarnessId() && this.editingSubHarnessRef && this.editingChildHarness) {
      this.handleSubHarnessEditModeMouseMove(event, x, y);
      return;
    }

    // Wire drawing
    if (this.isDrawingWire) {
      this.wireEndX = x;
      this.wireEndY = y;

      // Track hovered pin for green indicator
      this.hoveredPinConnectorId = null;
      this.hoveredPinId = null;
      this.hoveredMatingPinConnectorId = null;
      this.hoveredMatingPinId = null;
      this.hoveredCableId = null;
      this.hoveredCableWireId = null;
      this.hoveredCableSide = null;
      this.hoveredComponentId = null;
      this.hoveredComponentPinId = null;
      this.hoveredMatingSubHarnessId = null;
      this.hoveredMatingSubHarnessPinId = null;

      const data = this.harnessData();
      if (data) {
        // For mating wires, only check mating pins (on connectors and subharnesses)
        if (this.isDrawingMatingWire) {
          // Check connector mating pins
          for (const connector of data.connectors) {
            // Don't highlight the start connector's start pin
            if (connector.id === this.wireStartConnectorId) continue;

            const pinHit = hitTestConnectorPinWithSide(connector, x, y);
            if (pinHit && pinHit.side === 'mating') {
              this.hoveredMatingPinConnectorId = connector.id;
              this.hoveredMatingPinId = pinHit.pinId;
              break;
            }
          }

          // Check subharness mating pins if no connector pin found
          if (!this.hoveredMatingPinConnectorId) {
            for (const subHarness of (data.subHarnesses || [])) {
              const childHarness = this.subHarnessDataCache.get(subHarness.harnessId);
              const pinHit = hitTestSubHarnessPin(subHarness, childHarness, x, y, 'mating');
              if (pinHit) {
                this.hoveredMatingSubHarnessId = subHarness.id;
                this.hoveredMatingSubHarnessPinId = pinHit.pinId;
                break;
              }
            }
          }
        } else {
          // Regular wire - check wire-side connector pins
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
        }

        // Check component pins if no connector pin or cable wire found (only for regular wires)
        if (!this.isDrawingMatingWire && !this.hoveredPinConnectorId && !this.hoveredCableId) {
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

    // Dragging connector (only in normal mode, not edit mode)
    // Double-check we're not in edit mode to prevent conflicts with sub-harness editing
    if (this.isDragging && this.selectedConnectorId && !this.editingSubHarnessId()) {
      const data = this.harnessData();
      if (!data) return;

      const connector = data.connectors.find(c => c.id === this.selectedConnectorId);
      if (!connector) return;

      let newX = x - this.dragOffsetX;
      let newY = y - this.dragOffsetY;

      // Snap to grid
      if (true) {
        const grid = this.gridSize();
        newX = Math.round(newX / grid) * grid;
        newY = Math.round(newY / grid) * grid;
      }

      const deltaX = newX - (connector.position?.x || 0);
      const deltaY = newY - (connector.position?.y || 0);

      // If dragging multiple selected items, move them all
      if (this.isDraggingMultiSelection) {
        this.moveMultiSelectionBy(deltaX, deltaY);
      } else if (this.isDraggingGroup && connector.groupId) {
        // If dragging a grouped element, move the entire group
        this.moveGroupBy(connector.groupId, deltaX, deltaY);
      } else {
        // Update just this connector
        const connectors = data.connectors.map(c => {
          if (c.id === this.selectedConnectorId) {
            return { ...c, position: { x: newX, y: newY } };
          }
          return c;
        });
        this.dataChanged.emit({ ...data, connectors });
      }
    }

    // Dragging cable (only in normal mode, not edit mode)
    if (this.isDraggingCable && this.selectedCableId && !this.editingSubHarnessId()) {
      const data = this.harnessData();
      if (!data) return;

      const cable = data.cables.find(c => c.id === this.selectedCableId);
      if (!cable) return;

      let newX = x - this.dragOffsetX;
      let newY = y - this.dragOffsetY;

      // Snap to grid
      if (true) {
        const grid = this.gridSize();
        newX = Math.round(newX / grid) * grid;
        newY = Math.round(newY / grid) * grid;
      }

      const deltaX = newX - (cable.position?.x || 0);
      const deltaY = newY - (cable.position?.y || 0);

      // If dragging multiple selected items, move them all
      if (this.isDraggingMultiSelection) {
        this.moveMultiSelectionBy(deltaX, deltaY);
      } else if (this.isDraggingGroup && cable.groupId) {
        // If dragging a grouped element, move the entire group
        this.moveGroupBy(cable.groupId, deltaX, deltaY);
      } else {
        // Update just this cable
        const cables = data.cables.map(c => {
          if (c.id === this.selectedCableId) {
            return { ...c, position: { x: newX, y: newY } };
          }
          return c;
        });
        this.dataChanged.emit({ ...data, cables });
      }
    }

    // Dragging component (only in normal mode, not edit mode)
    if (this.isDraggingComponent && this.selectedComponentId && !this.editingSubHarnessId()) {
      const data = this.harnessData();
      if (!data) return;

      const component = (data.components || []).find(c => c.id === this.selectedComponentId);
      if (!component) return;

      let newX = x - this.dragOffsetX;
      let newY = y - this.dragOffsetY;

      // Snap to grid
      if (true) {
        const grid = this.gridSize();
        newX = Math.round(newX / grid) * grid;
        newY = Math.round(newY / grid) * grid;
      }

      const deltaX = newX - (component.position?.x || 0);
      const deltaY = newY - (component.position?.y || 0);

      // If dragging multiple selected items, move them all
      if (this.isDraggingMultiSelection) {
        this.moveMultiSelectionBy(deltaX, deltaY);
      } else if (this.isDraggingGroup && component.groupId) {
        // If dragging a grouped element, move the entire group
        this.moveGroupBy(component.groupId, deltaX, deltaY);
      } else {
        // Update just this component
        const components = (data.components || []).map(c => {
          if (c.id === this.selectedComponentId) {
            return { ...c, position: { x: newX, y: newY } };
          }
          return c;
        });
        this.dataChanged.emit({ ...data, components });
      }
    }

    // Dragging sub-harness
    if (this.isDraggingSubHarness && this.selectedSubHarnessId) {
      const data = this.harnessData();
      if (!data) return;

      const subHarness = (data.subHarnesses || []).find(s => s.id === this.selectedSubHarnessId);
      if (!subHarness) return;

      let newX = x - this.dragOffsetX;
      let newY = y - this.dragOffsetY;

      // Snap to grid
      if (true) {
        const grid = this.gridSize();
        newX = Math.round(newX / grid) * grid;
        newY = Math.round(newY / grid) * grid;
      }

      const deltaX = newX - (subHarness.position?.x || 0);
      const deltaY = newY - (subHarness.position?.y || 0);

      // If dragging multiple selected items, move them all
      if (this.isDraggingMultiSelection) {
        this.moveMultiSelectionBy(deltaX, deltaY);
      } else if (this.isDraggingGroup && subHarness.groupId) {
        // If dragging a grouped element, move the entire group
        this.moveGroupBy(subHarness.groupId, deltaX, deltaY);
      } else {
        // Update just this sub-harness
        const subHarnesses = (data.subHarnesses || []).map(s => {
          if (s.id === this.selectedSubHarnessId) {
            return { ...s, position: { x: newX, y: newY } };
          }
          return s;
        });
        this.dataChanged.emit({ ...data, subHarnesses });
      }
    }

    // Dragging wire control point
    if (this.isDraggingControlPoint && this.draggedConnectionId) {
      const data = this.harnessData();
      if (!data) return;

      let newX = x;
      let newY = y;

      // Snap to grid
      if (true) {
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
    if (!this.isDragging && !this.isDraggingCable && !this.isDraggingComponent && !this.isDraggingSubHarness && !this.isPanning && !this.isDrawingWire && !this.isDraggingControlPoint && !this.isDraggingLabel) {
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

          // Check if over a sub-harness body (for dragging)
          if (!found) {
            for (const subHarness of (data.subHarnesses || [])) {
              const childHarness = this.subHarnessDataCache.get(subHarness.harnessId);
              if (hitTestSubHarness(subHarness, childHarness, x, y)) {
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

          // Check if over a wire control point (only in nodeEdit mode)
          if (!found && this.activeTool() === 'nodeEdit' && this.selectedConnectionId) {
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

    // Handle sub-harness edit mode mouse up
    if (this.editingSubHarnessId() && this.editingSubHarnessRef && this.editingChildHarness) {
      this.handleSubHarnessEditModeMouseUp(event);
      return;
    }

    // End marquee selection
    if (this.isMarqueeSelecting) {
      this.isMarqueeSelecting = false;
      this.selectElementsInMarquee();
      this.render();
    }

    // End wire drawing
    if (this.isDrawingWire) {
      const { x, y } = this.screenToCanvas(event.clientX, event.clientY);
      const data = this.harnessData();

      if (data) {
        let connectionCreated = false;

        // For mating wires, only connect to mating pins (on connectors or subharnesses)
        if (this.isDrawingMatingWire) {
          // Check connector mating pins
          for (const connector of data.connectors) {
            // Don't connect to the same connector we started from
            if (this.wireStartConnectorId && connector.id === this.wireStartConnectorId) continue;

            const pinHit = hitTestConnectorPinWithSide(connector, x, y);
            if (pinHit && pinHit.side === 'mating') {
              // Create mating connection
              const newConnection: HarnessConnection = {
                id: `conn-${Date.now()}`,
                connectionType: 'mating',
                fromConnector: this.wireStartConnectorId || undefined,
                fromPin: this.wireStartPinId || undefined,
                fromSubHarness: this.wireStartSubHarnessId || undefined,
                fromSubConnector: this.wireStartSubHarnessConnectorId || undefined,
                toConnector: connector.id,
                toPin: pinHit.pinId
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

          // Check subharness mating pins if no connector found
          if (!connectionCreated) {
            for (const subHarness of (data.subHarnesses || [])) {
              const childHarness = this.subHarnessDataCache.get(subHarness.harnessId);
              const pinHit = hitTestSubHarnessPin(subHarness, childHarness, x, y, 'mating');
              if (pinHit) {
                // Parse the pinId to get connector and pin info
                // pinId format: "subHarnessId:connectorId:pinId"
                const parts = pinHit.pinId.split(':');
                const connectorId = parts[1];
                const actualPinId = parts[2];

                // Create mating connection to subharness
                const newConnection: HarnessConnection = {
                  id: `conn-${Date.now()}`,
                  connectionType: 'mating',
                  fromConnector: this.wireStartConnectorId || undefined,
                  fromPin: this.wireStartPinId || undefined,
                  fromSubHarness: this.wireStartSubHarnessId || undefined,
                  fromSubConnector: this.wireStartSubHarnessConnectorId || undefined,
                  toSubHarness: subHarness.id,
                  toSubConnector: connectorId,
                  toPin: actualPinId
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
        } else {
          // Regular wire - try to connect to a connector pin
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
      }

      this.isDrawingWire = false;
      this.isDrawingMatingWire = false;
      this.wireStartConnectorId = null;
      this.wireStartPinId = null;
      this.wireStartCableId = null;
      this.wireStartWireId = null;
      this.wireStartSide = null;
      this.wireStartComponentId = null;
      this.wireStartComponentPinId = null;
      this.wireStartSubHarnessId = null;
      this.wireStartSubHarnessConnectorId = null;
      this.hoveredPinConnectorId = null;
      this.hoveredPinId = null;
      this.hoveredMatingPinConnectorId = null;
      this.hoveredMatingPinId = null;
      this.hoveredMatingSubHarnessId = null;
      this.hoveredMatingSubHarnessPinId = null;
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

    // End dragging sub-harness
    if (this.isDraggingSubHarness) {
      this.isDraggingSubHarness = false;
    }

    // Reset multi-selection drag flag
    this.isDraggingMultiSelection = false;

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

    // Emit dragEnd if any drag operation started
    this.emitDragEndIfStarted();
  }

  onWheel(event: WheelEvent) {
    event.preventDefault();

    // Pan the canvas with scroll wheel
    this.panX -= event.deltaX;
    this.panY -= event.deltaY;

    this.render();
  }

  onDoubleClick(event: MouseEvent) {
    console.log('onDoubleClick called');
    const { x, y } = this.screenToCanvas(event.clientX, event.clientY);
    const data = this.harnessData();
    if (!data) return;
    console.log('onDoubleClick - checking wires, activeTool:', this.activeTool());

    // If in sub-harness edit mode, handle double-click on child elements
    if (this.editingSubHarnessId() && this.editingChildHarness?.harnessData) {
      const childData = this.editingChildHarness.harnessData;
      const subRef = this.editingSubHarnessRef!;
      const localPoint = this.transformToSubHarnessLocal(x, y, subRef);

      // Node Edit tool - double-click to add/remove nodes in sub-harness
      if (this.activeTool() === 'nodeEdit') {
        // Check all wires (including mating) for control point hits (to remove node)
        for (const connection of childData.connections || []) {
          const fromPos = this.getChildConnectionFromPos(childData, connection);
          const toPos = this.getChildConnectionToPos(childData, connection);
          if (!fromPos || !toPos) continue;

          const cpIndex = hitTestWireControlPoint(connection, fromPos, toPos, localPoint.x, localPoint.y, this.gridSize());
          if (cpIndex >= 0) {
            // Remove this control point
            this.removeChildWireControlPoint(childData, subRef.harnessId, connection.id, fromPos, toPos, cpIndex);
            return;
          }
        }

        // Check if double-clicking on a wire (to add node)
        for (const connection of childData.connections || []) {
          const fromPos = this.getChildConnectionFromPos(childData, connection);
          const toPos = this.getChildConnectionToPos(childData, connection);
          if (!fromPos || !toPos) continue;

          if (hitTestWire(connection, fromPos, toPos, localPoint.x, localPoint.y, this.gridSize())) {
            // Add a new control point at this position
            this.addChildWireControlPoint(childData, subRef.harnessId, connection.id, fromPos, toPos, localPoint.x, localPoint.y);
            return;
          }
        }
        return;
      }

      // Check child connectors
      for (const connector of childData.connectors || []) {
        if (hitTestConnector(connector, localPoint.x, localPoint.y)) {
          this.editChildConnector.emit({
            connector,
            subHarnessId: subRef.harnessId,
            childData
          });
          return;
        }
      }
      // Check child cables
      for (const cable of childData.cables || []) {
        if (cable.position && hitTestCable(cable, localPoint.x, localPoint.y)) {
          this.editChildCable.emit({
            cable,
            subHarnessId: subRef.harnessId,
            childData
          });
          return;
        }
      }
      // Check child components
      for (const component of childData.components || []) {
        if (hitTestComponent(component, localPoint.x, localPoint.y)) {
          this.editChildComponent.emit({
            component,
            subHarnessId: subRef.harnessId,
            childData
          });
          return;
        }
      }

      // Check if double-clicked on a wire in sub-harness - enter nodeEdit mode
      for (const connection of childData.connections || []) {
        const fromPos = this.getChildConnectionFromPos(childData, connection);
        const toPos = this.getChildConnectionToPos(childData, connection);
        if (!fromPos || !toPos) continue;

        if (hitTestWire(connection, fromPos, toPos, localPoint.x, localPoint.y, this.gridSize())) {
          // Select the wire and switch to nodeEdit mode
          this.selectedConnectionId = connection.id;
          this.selectedConnectorId = null;
          this.selectedCableId = null;
          this.selectedComponentId = null;
          this.selectionChanged.emit({ type: 'wire', connection });
          this.requestToolChange.emit('nodeEdit');
          this.render();
          return;
        }
      }
      return;
    }

    // Node Edit tool - double-click to add/remove nodes (parent harness)
    if (this.activeTool() === 'nodeEdit') {
      // Check all wires (including mating) for control point hits (to remove node)
      for (const connection of data.connections) {
        const fromPos = this.getConnectionFromPos(data, connection);
        const toPos = this.getConnectionToPos(data, connection);
        if (!fromPos || !toPos) continue;

        const cpIndex = hitTestWireControlPoint(connection, fromPos, toPos, x, y, this.gridSize());
        if (cpIndex >= 0) {
          // Remove this control point
          this.removeWireControlPoint(connection.id, cpIndex);
          return;
        }
      }

      // Check if double-clicking on a wire (to add node)
      for (const connection of data.connections) {
        const fromPos = this.getConnectionFromPos(data, connection);
        const toPos = this.getConnectionToPos(data, connection);
        if (!fromPos || !toPos) continue;

        if (hitTestWire(connection, fromPos, toPos, x, y, this.gridSize())) {
          // Add a new control point at this position
          this.addWireControlPoint(connection.id, fromPos, toPos, x, y);
          return;
        }
      }
      return;
    }

    // Check if double-clicked on a sub-harness to enter edit mode
    for (const subHarness of (data.subHarnesses || [])) {
      const childHarness = this.subHarnessDataCache.get(subHarness.harnessId);
      if (hitTestSubHarness(subHarness, childHarness, x, y)) {
        this.enterSubHarnessEditMode(subHarness);
        return;
      }
    }

    // Check if double-clicked on a wire - enter nodeEdit mode
    for (const connection of data.connections) {
      const fromPos = this.getConnectionFromPos(data, connection);
      const toPos = this.getConnectionToPos(data, connection);
      if (!fromPos || !toPos) continue;

      if (hitTestWire(connection, fromPos, toPos, x, y, this.gridSize())) {
        console.log('Double-clicked on wire, entering nodeEdit mode', connection.id);
        // Select the wire and switch to nodeEdit mode
        this.selectedConnectionId = connection.id;
        this.selectedConnectorId = null;
        this.selectedCableId = null;
        this.selectedComponentId = null;
        this.selectedSubHarnessId = null;
        this.selectionChanged.emit({ type: 'wire', connection });
        this.requestToolChange.emit('nodeEdit');
        this.render();
        return;
      }
    }

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
      case 'group':
        this.groupSelected();
        break;
      case 'ungroup':
        this.ungroupSelected();
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

    // Handle multi-selection deletion
    if (this.selectedIds.size > 0) {
      const connectorIdsToDelete = new Set<string>();
      const cableIdsToDelete = new Set<string>();
      const componentIdsToDelete = new Set<string>();
      const subHarnessIdsToDelete = new Set<string>();
      const connectionIdsToDelete = new Set<string>();

      for (const key of this.selectedIds) {
        const [type, id] = key.split(':');
        if (type === 'connector') connectorIdsToDelete.add(id);
        else if (type === 'cable') cableIdsToDelete.add(id);
        else if (type === 'component') componentIdsToDelete.add(id);
        else if (type === 'subHarness') subHarnessIdsToDelete.add(id);
        else if (type === 'connection') connectionIdsToDelete.add(id);
      }

      // Filter out deleted elements
      const connectors = data.connectors.filter(c => !connectorIdsToDelete.has(c.id));
      const cables = data.cables.filter(c => !cableIdsToDelete.has(c.id));
      const components = (data.components || []).filter(c => !componentIdsToDelete.has(c.id));
      const subHarnesses = (data.subHarnesses || []).filter(s => !subHarnessIdsToDelete.has(s.id));

      // Filter out connections that reference deleted elements or are themselves selected
      const connections = data.connections.filter(conn => {
        if (connectionIdsToDelete.has(conn.id)) return false;
        if (conn.fromConnector && connectorIdsToDelete.has(conn.fromConnector)) return false;
        if (conn.toConnector && connectorIdsToDelete.has(conn.toConnector)) return false;
        if (conn.fromCable && cableIdsToDelete.has(conn.fromCable)) return false;
        if (conn.toCable && cableIdsToDelete.has(conn.toCable)) return false;
        if (conn.fromComponent && componentIdsToDelete.has(conn.fromComponent)) return false;
        if (conn.toComponent && componentIdsToDelete.has(conn.toComponent)) return false;
        if (conn.fromSubHarness && subHarnessIdsToDelete.has(conn.fromSubHarness)) return false;
        if (conn.toSubHarness && subHarnessIdsToDelete.has(conn.toSubHarness)) return false;
        return true;
      });

      // Clear all selection state
      this.selectedIds.clear();
      this.selectedConnectorId = null;
      this.selectedCableId = null;
      this.selectedComponentId = null;
      this.selectedSubHarnessId = null;
      this.selectedConnectionId = null;
      this.selectionChanged.emit({ type: 'none' });
      this.dataChanged.emit({ ...data, connectors, cables, components, subHarnesses, connections });
      this.render();
      return;
    }

    // Handle single selection deletion (legacy)
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
    } else if (this.selectedSubHarnessId) {
      // Remove sub-harness and its connections
      const subHarnesses = (data.subHarnesses || []).filter(s => s.id !== this.selectedSubHarnessId);
      const connections = data.connections.filter(
        conn => conn.fromSubHarness !== this.selectedSubHarnessId &&
          conn.toSubHarness !== this.selectedSubHarnessId
      );

      this.selectedSubHarnessId = null;
      this.selectionChanged.emit({ type: 'none' });
      this.dataChanged.emit({ ...data, subHarnesses, connections });
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

  // Update sub-harness data in the cache (called after editing child elements)
  updateSubHarnessData(subHarnessId: number, data: HarnessData) {
    const cached = this.subHarnessDataCache.get(subHarnessId);
    if (cached) {
      cached.harnessData = data;
      this.subHarnessDataCache.set(subHarnessId, cached);
    }
    // Also update editingChildHarness if we're editing this sub-harness
    if (this.editingChildHarness && this.editingSubHarnessRef?.harnessId === subHarnessId) {
      this.editingChildHarness.harnessData = data;
    }
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
    const data = this.harnessData();
    if (!data) return null;

    const padding = this.gridSize();

    // Calculate bounding box of all elements based on actual drawing coordinates
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    // Constants from harness/constants.ts
    const ROW_HEIGHT = 20;
    const CABLE_WIRE_SPACING = 20;

    // Include connectors
    // Drawing: ctx.translate(x, y - ROW_HEIGHT/2), top = -HEADER_HEIGHT - imageHeight - partNameHeight
    // So world top = y - ROW_HEIGHT/2 - HEADER_HEIGHT - imageHeight - partNameHeight
    // World bottom = y - ROW_HEIGHT/2 + pinCount * ROW_HEIGHT
    for (const connector of data.connectors) {
      if (!connector.position) continue;
      const dims = getConnectorDimensions(connector);
      const pinCount = connector.pins?.length || connector.pinCount || 1;
      const headerAndExtras = dims.height - (pinCount * ROW_HEIGHT);
      minX = Math.min(minX, connector.position.x);
      minY = Math.min(minY, connector.position.y - ROW_HEIGHT / 2 - headerAndExtras);
      maxX = Math.max(maxX, connector.position.x + dims.width);
      maxY = Math.max(maxY, connector.position.y - ROW_HEIGHT / 2 + pinCount * ROW_HEIGHT);
    }

    // Include cables
    // Drawing: ctx.translate(x, y), top = -HEADER_HEIGHT - partNameHeight - infoHeight - WIRE_SPACING/2
    // World top = y - HEADER_HEIGHT - partNameHeight - infoHeight - WIRE_SPACING/2
    // World bottom = y + (wireCount - 0.5) * WIRE_SPACING
    for (const cable of data.cables) {
      if (!cable.position) continue;
      const dims = getCableDimensions(cable);
      const wireCount = cable.wires?.length || cable.wireCount || 1;
      const headerAndExtras = dims.height - (wireCount * CABLE_WIRE_SPACING);
      minX = Math.min(minX, cable.position.x);
      minY = Math.min(minY, cable.position.y - headerAndExtras - CABLE_WIRE_SPACING / 2);
      maxX = Math.max(maxX, cable.position.x + dims.width);
      maxY = Math.max(maxY, cable.position.y + (wireCount - 0.5) * CABLE_WIRE_SPACING);
    }

    // Include components (similar to connectors)
    for (const component of (data.components || [])) {
      if (!component.position) continue;
      const dims = getComponentDimensions(component);
      // Components have pin groups, calculate total pins
      let totalPins = 0;
      for (const group of component.pinGroups || []) {
        totalPins += group.pins?.length || 0;
      }
      totalPins = Math.max(totalPins, 1);
      const headerAndExtras = dims.height - (totalPins * ROW_HEIGHT);
      minX = Math.min(minX, component.position.x);
      minY = Math.min(minY, component.position.y - ROW_HEIGHT / 2 - headerAndExtras);
      maxX = Math.max(maxX, component.position.x + dims.width);
      maxY = Math.max(maxY, component.position.y - ROW_HEIGHT / 2 + totalPins * ROW_HEIGHT);
    }

    // Include sub-harnesses (uses bounds relative to position)
    for (const subHarness of (data.subHarnesses || [])) {
      if (!subHarness.position) continue;
      const childHarness = this.subHarnessDataCache.get(subHarness.harnessId);
      const dims = getSubHarnessDimensions(subHarness, childHarness);
      minX = Math.min(minX, subHarness.position.x + dims.bounds.minX);
      minY = Math.min(minY, subHarness.position.y + dims.bounds.minY);
      maxX = Math.max(maxX, subHarness.position.x + dims.bounds.maxX);
      maxY = Math.max(maxY, subHarness.position.y + dims.bounds.maxY);
    }

    // Include wire endpoints and waypoints
    for (const connection of data.connections) {
      const fromPos = this.getConnectionFromPos(data, connection);
      const toPos = this.getConnectionToPos(data, connection);
      if (fromPos) {
        minX = Math.min(minX, fromPos.x);
        minY = Math.min(minY, fromPos.y);
        maxX = Math.max(maxX, fromPos.x);
        maxY = Math.max(maxY, fromPos.y);
      }
      if (toPos) {
        minX = Math.min(minX, toPos.x);
        minY = Math.min(minY, toPos.y);
        maxX = Math.max(maxX, toPos.x);
        maxY = Math.max(maxY, toPos.y);
      }
      // Include waypoints
      if (connection.waypoints) {
        for (const wp of connection.waypoints) {
          minX = Math.min(minX, wp.x);
          minY = Math.min(minY, wp.y);
          maxX = Math.max(maxX, wp.x);
          maxY = Math.max(maxY, wp.y);
        }
      }
    }

    // If no elements, return null
    if (minX === Infinity) return null;

    // Add padding
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const exportWidth = maxX - minX;
    const exportHeight = maxY - minY;

    // Create an off-screen canvas for export with transparent background
    const exportCanvas = document.createElement('canvas');
    const exportCtx = exportCanvas.getContext('2d');
    if (!exportCtx) return null;

    // Set canvas size to cropped dimensions
    exportCanvas.width = exportWidth;
    exportCanvas.height = exportHeight;

    // Clear with transparent background (default)
    exportCtx.clearRect(0, 0, exportWidth, exportHeight);

    // Translate so elements are drawn at correct position within cropped canvas
    exportCtx.save();
    exportCtx.translate(-minX, -minY);

    // Compute obstacles for wire routing
    const wireObstacles = this.getWireObstacles();

    // Draw wires
    data.connections.forEach(connection => {
      const fromPos = this.getConnectionFromPos(data, connection);
      const toPos = this.getConnectionToPos(data, connection);
      if (fromPos && toPos) {
        let wireColor = connection.color || 'BK';
        const isMatingConnection = (connection as any).connectionType === 'mating';
        if (isMatingConnection) {
          drawMatingConnection(exportCtx, connection, fromPos, toPos, false, this.gridSize(), wireObstacles, false);
        } else {
          drawWire(exportCtx, connection, fromPos, toPos, wireColor, false, this.gridSize(), undefined, wireObstacles, false);
        }
      }
    });

    // Sort elements by zIndex for proper layering
    type DrawElement =
      | { type: 'connector'; element: HarnessConnector; zIndex: number }
      | { type: 'cable'; element: HarnessCable; zIndex: number }
      | { type: 'component'; element: HarnessComponent; zIndex: number };

    const elements: DrawElement[] = [
      ...data.connectors.map(c => ({ type: 'connector' as const, element: c, zIndex: c.zIndex || 0 })),
      ...data.cables.filter(c => c.position).map(c => ({ type: 'cable' as const, element: c, zIndex: c.zIndex || 0 })),
      ...(data.components || []).map(c => ({ type: 'component' as const, element: c, zIndex: c.zIndex || 0 }))
    ];
    elements.sort((a, b) => a.zIndex - b.zIndex);

    // Draw elements
    for (const item of elements) {
      if (item.type === 'connector') {
        drawConnector(exportCtx, item.element, false, this.loadedImages);
      } else if (item.type === 'cable') {
        drawCable(exportCtx, item.element, false, this.loadedImages);
      } else if (item.type === 'component') {
        drawComponent(exportCtx, item.element, false, this.loadedImages);
      }
    }

    // Draw sub-harnesses
    for (const subHarness of (data.subHarnesses || [])) {
      const childHarness = this.subHarnessDataCache.get(subHarness.harnessId);
      drawSubHarnessCollapsed(exportCtx, subHarness, childHarness, false, this.loadedImages);
    }

    // DEBUG: Draw bounding boxes around elements
    exportCtx.lineWidth = 2;

    // Helper to rotate a point around origin and translate
    const transformPoint = (localX: number, localY: number, originX: number, originY: number, rotation: number) => {
      const rad = (rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      return {
        x: originX + localX * cos - localY * sin,
        y: originY + localX * sin + localY * cos
      };
    };

    // Helper to get axis-aligned bounds from rotated corners
    const getRotatedBounds = (localMinX: number, localMinY: number, localMaxX: number, localMaxY: number,
                               originX: number, originY: number, rotation: number) => {
      const corners = [
        transformPoint(localMinX, localMinY, originX, originY, rotation),
        transformPoint(localMaxX, localMinY, originX, originY, rotation),
        transformPoint(localMaxX, localMaxY, originX, originY, rotation),
        transformPoint(localMinX, localMaxY, originX, originY, rotation)
      ];
      return {
        minX: Math.min(...corners.map(c => c.x)),
        minY: Math.min(...corners.map(c => c.y)),
        maxX: Math.max(...corners.map(c => c.x)),
        maxY: Math.max(...corners.map(c => c.y))
      };
    };

    // Connector bounds (red)
    exportCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
    for (const connector of data.connectors) {
      if (!connector.position) continue;
      const dims = getConnectorDimensions(connector);
      const pinCount = connector.pins?.length || connector.pinCount || 1;
      const headerAndExtras = dims.height - (pinCount * ROW_HEIGHT);
      const rotation = connector.rotation || 0;
      const originX = connector.position.x;
      const originY = connector.position.y - ROW_HEIGHT / 2;
      const localMinX = 0;
      const localMinY = -headerAndExtras;
      const localMaxX = dims.width;
      const localMaxY = pinCount * ROW_HEIGHT;
      const bounds = getRotatedBounds(localMinX, localMinY, localMaxX, localMaxY, originX, originY, rotation);
      exportCtx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    }

    // Cable bounds (green)
    exportCtx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
    for (const cable of data.cables) {
      if (!cable.position) continue;
      const dims = getCableDimensions(cable);
      const wireCount = cable.wires?.length || cable.wireCount || 1;
      const headerAndExtras = dims.height - (wireCount * CABLE_WIRE_SPACING);
      const rotation = cable.rotation || 0;
      const originX = cable.position.x;
      const originY = cable.position.y;
      const localMinX = 0;
      const localMinY = -headerAndExtras - CABLE_WIRE_SPACING / 2;
      const localMaxX = dims.width;
      const localMaxY = (wireCount - 0.5) * CABLE_WIRE_SPACING;
      const bounds = getRotatedBounds(localMinX, localMinY, localMaxX, localMaxY, originX, originY, rotation);
      exportCtx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    }

    // Component bounds (blue)
    exportCtx.strokeStyle = 'rgba(0, 0, 255, 0.8)';
    for (const component of (data.components || [])) {
      if (!component.position) continue;
      const dims = getComponentDimensions(component);
      let totalPins = 0;
      for (const group of component.pinGroups || []) {
        totalPins += group.pins?.length || 0;
      }
      totalPins = Math.max(totalPins, 1);
      const headerAndExtras = dims.height - (totalPins * ROW_HEIGHT);
      const rotation = component.rotation || 0;
      const originX = component.position.x;
      const originY = component.position.y - ROW_HEIGHT / 2;
      const localMinX = 0;
      const localMinY = -headerAndExtras;
      const localMaxX = dims.width;
      const localMaxY = totalPins * ROW_HEIGHT;
      const bounds = getRotatedBounds(localMinX, localMinY, localMaxX, localMaxY, originX, originY, rotation);
      exportCtx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    }

    // Sub-harness bounds (magenta)
    exportCtx.strokeStyle = 'rgba(255, 0, 255, 0.8)';
    for (const subHarness of (data.subHarnesses || [])) {
      if (!subHarness.position) continue;
      const childHarness = this.subHarnessDataCache.get(subHarness.harnessId);
      const dims = getSubHarnessDimensions(subHarness, childHarness);
      const rotation = subHarness.rotation || 0;
      const originX = subHarness.position.x;
      const originY = subHarness.position.y;
      const bounds = getRotatedBounds(dims.bounds.minX, dims.bounds.minY, dims.bounds.maxX, dims.bounds.maxY, originX, originY, rotation);
      exportCtx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    }

    // Wire bounds (cyan) - draw bounding box around each wire's path points
    exportCtx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
    for (const connection of data.connections) {
      const fromPos = this.getConnectionFromPos(data, connection);
      const toPos = this.getConnectionToPos(data, connection);
      if (!fromPos || !toPos) continue;

      // Get all path points - either stored waypoints or calculated orthogonal path
      const pathPoints = connection.waypoints?.length
        ? [fromPos, ...connection.waypoints, toPos]
        : calculateOrthogonalPath(fromPos, toPos, this.gridSize(), wireObstacles);

      let wMinX = Infinity;
      let wMinY = Infinity;
      let wMaxX = -Infinity;
      let wMaxY = -Infinity;

      for (const pt of pathPoints) {
        wMinX = Math.min(wMinX, pt.x);
        wMinY = Math.min(wMinY, pt.y);
        wMaxX = Math.max(wMaxX, pt.x);
        wMaxY = Math.max(wMaxY, pt.y);
      }

      // Draw wire bounding box
      exportCtx.strokeRect(wMinX - 2, wMinY - 2, wMaxX - wMinX + 4, wMaxY - wMinY + 4);

      // Draw small circles at endpoints
      exportCtx.fillStyle = 'rgba(0, 255, 255, 0.8)';
      exportCtx.beginPath();
      exportCtx.arc(fromPos.x, fromPos.y, 4, 0, Math.PI * 2);
      exportCtx.fill();
      exportCtx.beginPath();
      exportCtx.arc(toPos.x, toPos.y, 4, 0, Math.PI * 2);
      exportCtx.fill();

      // Draw small squares at intermediate path points
      for (let i = 1; i < pathPoints.length - 1; i++) {
        const pt = pathPoints[i];
        exportCtx.fillRect(pt.x - 3, pt.y - 3, 6, 6);
      }
    }

    // Overall bounds (yellow dashed)
    exportCtx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
    exportCtx.setLineDash([5, 5]);
    exportCtx.strokeRect(minX + padding, minY + padding, maxX - minX - 2 * padding, maxY - minY - 2 * padding);
    exportCtx.setLineDash([]);

    exportCtx.restore();

    return exportCanvas.toDataURL('image/png');
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
    const isMating = connection.connectionType === 'mating';
    const pinSide = isMating ? 'mating' : 'wire';

    // Check subharness endpoints first
    if (connection.fromSubHarness && connection.fromSubConnector && connection.fromPin) {
      const subHarness = (data.subHarnesses || []).find(s => s.id === connection.fromSubHarness);
      if (subHarness) {
        const childHarness = this.subHarnessDataCache.get(subHarness.harnessId);
        const pins = getSubHarnessPinPositions(subHarness, childHarness, pinSide);
        const pin = pins.find(p => p.connectorId === connection.fromSubConnector && p.connectorPinId === connection.fromPin);
        if (pin) return pin;
      }
    }

    if (connection.fromConnector && connection.fromPin) {
      const fromConnector = data.connectors.find(c => c.id === connection.fromConnector);
      if (fromConnector) {
        const pins = getConnectorPinPositions(fromConnector, pinSide);
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
    const isMating = connection.connectionType === 'mating';
    const pinSide = isMating ? 'mating' : 'wire';

    // Check subharness endpoints first
    if (connection.toSubHarness && connection.toSubConnector && connection.toPin) {
      const subHarness = (data.subHarnesses || []).find(s => s.id === connection.toSubHarness);
      if (subHarness) {
        const childHarness = this.subHarnessDataCache.get(subHarness.harnessId);
        const pins = getSubHarnessPinPositions(subHarness, childHarness, pinSide);
        const pin = pins.find(p => p.connectorId === connection.toSubConnector && p.connectorPinId === connection.toPin);
        if (pin) return pin;
      }
    }

    if (connection.toConnector && connection.toPin) {
      const toConnector = data.connectors.find(c => c.id === connection.toConnector);
      if (toConnector) {
        const pins = getConnectorPinPositions(toConnector, pinSide);
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
        fromSubHarness: connection.toSubHarness,
        fromSubConnector: connection.toSubConnector,
        toConnector: connection.fromConnector,
        toPin: connection.fromPin,
        toCable: connection.fromCable,
        toWire: connection.fromWire,
        toSide: connection.fromSide,
        toComponent: connection.fromComponent,
        toComponentPin: connection.fromComponentPin,
        toTermination: connection.fromTermination,
        toSubHarness: connection.fromSubHarness,
        toSubConnector: connection.fromSubConnector,
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

  // Add element to multi-selection
  addToSelection(type: string, id: string) {
    this.selectedIds.add(`${type}:${id}`);
  }

  // Remove element from multi-selection
  removeFromSelection(type: string, id: string) {
    this.selectedIds.delete(`${type}:${id}`);
  }

  // Select all elements in a group
  selectGroupMembers(groupId: string) {
    if (!groupId) return;
    const members = this.getGroupMembers(groupId);
    for (const member of members) {
      this.selectedIds.add(`${member.type}:${member.id}`);
    }
  }

  // Clear multi-selection
  clearMultiSelection() {
    this.selectedIds.clear();
  }

  // Check if multiple elements are selected
  hasMultipleSelected(): boolean {
    return this.selectedIds.size > 1;
  }

  // Get the group ID of the currently selected element
  getSelectedGroupId(): string | null {
    const data = this.harnessData();
    if (!data) return null;

    if (this.selectedConnectorId) {
      const connector = data.connectors.find(c => c.id === this.selectedConnectorId);
      return connector?.groupId || null;
    }
    if (this.selectedCableId) {
      const cable = data.cables.find(c => c.id === this.selectedCableId);
      return cable?.groupId || null;
    }
    if (this.selectedComponentId) {
      const component = (data.components || []).find(c => c.id === this.selectedComponentId);
      return component?.groupId || null;
    }
    if (this.selectedSubHarnessId) {
      const subHarness = (data.subHarnesses || []).find(s => s.id === this.selectedSubHarnessId);
      return subHarness?.groupId || null;
    }
    return null;
  }

  // Group all currently selected elements
  groupSelected() {
    const data = this.harnessData();
    if (!data || this.selectedIds.size < 2) return;

    const groupId = `group-${Date.now()}`;

    // Update all selected elements with the new group ID
    const connectors = data.connectors.map(c => {
      if (this.selectedIds.has(`connector:${c.id}`)) {
        return { ...c, groupId };
      }
      return c;
    });

    const cables = data.cables.map(c => {
      if (this.selectedIds.has(`cable:${c.id}`)) {
        return { ...c, groupId };
      }
      return c;
    });

    const components = (data.components || []).map(c => {
      if (this.selectedIds.has(`component:${c.id}`)) {
        return { ...c, groupId };
      }
      return c;
    });

    const subHarnesses = (data.subHarnesses || []).map(s => {
      if (this.selectedIds.has(`subHarness:${s.id}`)) {
        return { ...s, groupId };
      }
      return s;
    });

    this.dataChanged.emit({ ...data, connectors, cables, components, subHarnesses });
    this.clearMultiSelection();
    this.render();
  }

  // Ungroup the currently selected element's group
  ungroupSelected() {
    const data = this.harnessData();
    if (!data) return;

    const groupId = this.getSelectedGroupId();
    if (!groupId) return;

    // Remove group ID from all elements in this group
    const connectors = data.connectors.map(c => {
      if (c.groupId === groupId) {
        const { groupId: _, ...rest } = c;
        return rest as HarnessConnector;
      }
      return c;
    });

    const cables = data.cables.map(c => {
      if (c.groupId === groupId) {
        const { groupId: _, ...rest } = c;
        return rest as HarnessCable;
      }
      return c;
    });

    const components = (data.components || []).map(c => {
      if (c.groupId === groupId) {
        const { groupId: _, ...rest } = c;
        return rest as HarnessComponent;
      }
      return c;
    });

    const subHarnesses = (data.subHarnesses || []).map(s => {
      if (s.groupId === groupId) {
        const { groupId: _, ...rest } = s;
        return rest as SubHarnessRef;
      }
      return s;
    });

    this.dataChanged.emit({ ...data, connectors, cables, components, subHarnesses });
    this.render();
  }

  // Get all elements in the same group as the given element
  private getGroupMembers(groupId: string): { type: string; id: string; position: { x: number; y: number } }[] {
    const data = this.harnessData();
    if (!data || !groupId) return [];

    const members: { type: string; id: string; position: { x: number; y: number } }[] = [];

    for (const c of data.connectors) {
      if (c.groupId === groupId && c.position) {
        members.push({ type: 'connector', id: c.id, position: c.position });
      }
    }

    for (const c of data.cables) {
      if (c.groupId === groupId && c.position) {
        members.push({ type: 'cable', id: c.id, position: c.position });
      }
    }

    for (const c of (data.components || [])) {
      if (c.groupId === groupId && c.position) {
        members.push({ type: 'component', id: c.id, position: c.position });
      }
    }

    for (const s of (data.subHarnesses || [])) {
      if (s.groupId === groupId && s.position) {
        members.push({ type: 'subHarness', id: s.id, position: s.position });
      }
    }

    return members;
  }

  // Draw a border around a group of selected elements
  private drawGroupBorder(ctx: CanvasRenderingContext2D, groupId: string) {
    const data = this.harnessData();
    if (!data || !groupId) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasMembers = false;

    // Calculate bounding box from all group members
    for (const c of data.connectors) {
      if (c.groupId === groupId && c.position) {
        const dims = getConnectorDimensions(c);
        minX = Math.min(minX, c.position.x);
        minY = Math.min(minY, c.position.y - dims.height / 2);
        maxX = Math.max(maxX, c.position.x + dims.width);
        maxY = Math.max(maxY, c.position.y + dims.height / 2);
        hasMembers = true;
      }
    }

    for (const c of data.cables) {
      if (c.groupId === groupId && c.position) {
        const dims = getCableDimensions(c);
        minX = Math.min(minX, c.position.x);
        minY = Math.min(minY, c.position.y);
        maxX = Math.max(maxX, c.position.x + dims.width);
        maxY = Math.max(maxY, c.position.y + dims.height);
        hasMembers = true;
      }
    }

    for (const c of (data.components || [])) {
      if (c.groupId === groupId && c.position) {
        const dims = getComponentDimensions(c);
        minX = Math.min(minX, c.position.x);
        minY = Math.min(minY, c.position.y - dims.height / 2);
        maxX = Math.max(maxX, c.position.x + dims.width);
        maxY = Math.max(maxY, c.position.y + dims.height / 2);
        hasMembers = true;
      }
    }

    for (const s of (data.subHarnesses || [])) {
      if (s.groupId === groupId && s.position) {
        const childHarness = this.subHarnessDataCache.get(s.harnessId);
        const dims = getSubHarnessDimensions(s, childHarness);
        minX = Math.min(minX, s.position.x + dims.bounds.minX);
        minY = Math.min(minY, s.position.y + dims.bounds.minY);
        maxX = Math.max(maxX, s.position.x + dims.bounds.maxX);
        maxY = Math.max(maxY, s.position.y + dims.bounds.maxY);
        hasMembers = true;
      }
    }

    if (!hasMembers) return;

    // Add padding
    const padding = 10;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    // Draw the group border
    ctx.save();
    ctx.strokeStyle = '#2196F3';  // Blue color for group
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.roundRect(minX, minY, maxX - minX, maxY - minY, 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Move all elements in a group by the given delta
  private moveGroupBy(groupId: string, deltaX: number, deltaY: number) {
    const data = this.harnessData();
    if (!data || !groupId) return;

    const connectors = data.connectors.map(c => {
      if (c.groupId === groupId && c.position) {
        return { ...c, position: { x: c.position.x + deltaX, y: c.position.y + deltaY } };
      }
      return c;
    });

    const cables = data.cables.map(c => {
      if (c.groupId === groupId && c.position) {
        return { ...c, position: { x: c.position.x + deltaX, y: c.position.y + deltaY } };
      }
      return c;
    });

    const components = (data.components || []).map(c => {
      if (c.groupId === groupId && c.position) {
        return { ...c, position: { x: c.position.x + deltaX, y: c.position.y + deltaY } };
      }
      return c;
    });

    const subHarnesses = (data.subHarnesses || []).map(s => {
      if (s.groupId === groupId && s.position) {
        return { ...s, position: { x: s.position.x + deltaX, y: s.position.y + deltaY } };
      }
      return s;
    });

    this.dataChanged.emit({ ...data, connectors, cables, components, subHarnesses });
  }

  // Move all elements in the multi-selection by a delta
  private moveMultiSelectionBy(deltaX: number, deltaY: number) {
    const data = this.harnessData();
    if (!data) return;

    // Parse selected IDs to get types and IDs
    const selectedConnectorIds = new Set<string>();
    const selectedCableIds = new Set<string>();
    const selectedComponentIds = new Set<string>();
    const selectedSubHarnessIds = new Set<string>();

    for (const key of this.selectedIds) {
      const [type, id] = key.split(':');
      if (type === 'connector') selectedConnectorIds.add(id);
      else if (type === 'cable') selectedCableIds.add(id);
      else if (type === 'component') selectedComponentIds.add(id);
      else if (type === 'subHarness') selectedSubHarnessIds.add(id);
    }

    const connectors = data.connectors.map(c => {
      if (selectedConnectorIds.has(c.id) && c.position) {
        return { ...c, position: { x: c.position.x + deltaX, y: c.position.y + deltaY } };
      }
      return c;
    });

    const cables = data.cables.map(c => {
      if (selectedCableIds.has(c.id) && c.position) {
        return { ...c, position: { x: c.position.x + deltaX, y: c.position.y + deltaY } };
      }
      return c;
    });

    const components = (data.components || []).map(c => {
      if (selectedComponentIds.has(c.id) && c.position) {
        return { ...c, position: { x: c.position.x + deltaX, y: c.position.y + deltaY } };
      }
      return c;
    });

    const subHarnesses = (data.subHarnesses || []).map(s => {
      if (selectedSubHarnessIds.has(s.id) && s.position) {
        return { ...s, position: { x: s.position.x + deltaX, y: s.position.y + deltaY } };
      }
      return s;
    });

    this.dataChanged.emit({ ...data, connectors, cables, components, subHarnesses });
  }

  // Select all elements within the marquee rectangle
  private selectElementsInMarquee() {
    const data = this.harnessData();
    if (!data) return;

    const minX = Math.min(this.marqueeStartX, this.marqueeEndX);
    const maxX = Math.max(this.marqueeStartX, this.marqueeEndX);
    const minY = Math.min(this.marqueeStartY, this.marqueeEndY);
    const maxY = Math.max(this.marqueeStartY, this.marqueeEndY);

    // Don't select if marquee is too small (just a click)
    if (maxX - minX < 5 && maxY - minY < 5) {
      return;
    }

    // Check connectors
    for (const connector of data.connectors) {
      if (!connector.position) continue;
      const dims = getConnectorDimensions(connector);
      if (this.rectContains(connector.position.x, connector.position.y, dims.width, dims.height, minX, minY, maxX, maxY)) {
        this.addToSelection('connector', connector.id);
      }
    }

    // Check cables
    for (const cable of data.cables) {
      if (!cable.position) continue;
      const dims = getCableDimensions(cable);
      if (this.rectContains(cable.position.x, cable.position.y, dims.width, dims.height, minX, minY, maxX, maxY)) {
        this.addToSelection('cable', cable.id);
      }
    }

    // Check components
    for (const component of (data.components || [])) {
      if (!component.position) continue;
      const dims = getComponentDimensions(component);
      if (this.rectContains(component.position.x, component.position.y, dims.width, dims.height, minX, minY, maxX, maxY)) {
        this.addToSelection('component', component.id);
      }
    }

    // Check sub-harnesses
    for (const subHarness of (data.subHarnesses || [])) {
      if (!subHarness.position) continue;
      const childHarness = this.subHarnessDataCache.get(subHarness.harnessId);
      const dims = getSubHarnessDimensions(subHarness, childHarness);
      if (this.rectContains(subHarness.position.x + dims.bounds.minX, subHarness.position.y + dims.bounds.minY,
        dims.width, dims.height, minX, minY, maxX, maxY)) {
        this.addToSelection('subHarness', subHarness.id);
      }
    }

    // Check wires/connections
    for (const connection of data.connections) {
      const fromPos = this.getConnectionFromPos(data, connection);
      const toPos = this.getConnectionToPos(data, connection);
      if (fromPos && toPos) {
        // Check if BOTH endpoints are in the marquee (entire wire must be contained)
        const fromInRect = fromPos.x >= minX && fromPos.x <= maxX && fromPos.y >= minY && fromPos.y <= maxY;
        const toInRect = toPos.x >= minX && toPos.x <= maxX && toPos.y >= minY && toPos.y <= maxY;
        if (fromInRect && toInRect) {
          this.addToSelection('connection', connection.id);
        }
      }
    }

    // Emit selection change with selected IDs
    this.selectionChanged.emit({
      type: 'none',
      selectedIds: Array.from(this.selectedIds).map(s => {
        const [type, id] = s.split(':');
        return { type, id };
      })
    });
  }

  // Check if two rectangles intersect
  private rectIntersects(
    x1: number, y1: number, w1: number, h1: number,
    minX: number, minY: number, maxX: number, maxY: number
  ): boolean {
    return x1 < maxX && x1 + w1 > minX && y1 < maxY && y1 + h1 > minY;
  }

  // Check if the first rectangle is entirely contained within the second
  private rectContains(
    x1: number, y1: number, w1: number, h1: number,
    minX: number, minY: number, maxX: number, maxY: number
  ): boolean {
    return x1 >= minX && x1 + w1 <= maxX && y1 >= minY && y1 + h1 <= maxY;
  }

  // Get obstacles for wire routing (connectors, cables, components, subharnesses)
  private getWireObstacles(): WireObstacle[] {
    const data = this.harnessData();
    if (!data) return [];

    const obstacles: WireObstacle[] = [];
    const padding = this.gridSize(); // One grid spacing around obstacles

    // Add connectors as obstacles
    for (const c of data.connectors) {
      if (!c.position) continue;
      const dims = getConnectorDimensions(c);
      obstacles.push({
        minX: c.position.x - padding,
        minY: c.position.y - dims.height / 2 - padding,
        maxX: c.position.x + dims.width + padding,
        maxY: c.position.y + dims.height / 2 + padding
      });
    }

    // Add cables as obstacles
    for (const c of data.cables) {
      if (!c.position) continue;
      const dims = getCableDimensions(c);
      obstacles.push({
        minX: c.position.x - padding,
        minY: c.position.y - padding,
        maxX: c.position.x + dims.width + padding,
        maxY: c.position.y + dims.height + padding
      });
    }

    // Add components as obstacles
    for (const c of (data.components || [])) {
      if (!c.position) continue;
      const dims = getComponentDimensions(c);
      obstacles.push({
        minX: c.position.x - padding,
        minY: c.position.y - dims.height / 2 - padding,
        maxX: c.position.x + dims.width + padding,
        maxY: c.position.y + dims.height / 2 + padding
      });
    }

    // Add sub-harnesses as obstacles
    for (const s of (data.subHarnesses || [])) {
      if (!s.position) continue;
      const childHarness = this.subHarnessDataCache.get(s.harnessId);
      const dims = getSubHarnessDimensions(s, childHarness);
      obstacles.push({
        minX: s.position.x + dims.bounds.minX - padding,
        minY: s.position.y + dims.bounds.minY - padding,
        maxX: s.position.x + dims.bounds.maxX + padding,
        maxY: s.position.y + dims.bounds.maxY + padding
      });
    }

    return obstacles;
  }

  // Sub-harness edit mode methods

  /**
   * Enter sub-harness edit mode
   */
  enterSubHarnessEditMode(subHarness: SubHarnessRef): void {
    const childHarness = this.subHarnessDataCache.get(subHarness.harnessId);
    if (!childHarness) {
      console.warn('Cannot enter edit mode: sub-harness data not loaded');
      return;
    }

    this.editingSubHarnessId.set(subHarness.id);
    this.editingSubHarnessRef = subHarness;
    this.editingChildHarness = childHarness;

    // Clear any current selection
    this.clearSelection();
    this.clearMultiSelection();

    // Notify parent component
    this.subHarnessEditModeChanged.emit(true);

    this.render();
  }

  /**
   * Exit sub-harness edit mode
   */
  exitSubHarnessEditMode(): void {
    if (!this.editingSubHarnessId()) return;

    // Save any changes to the sub-harness
    if (this.editingChildHarness && this.editingSubHarnessRef) {
      this.subHarnessDataChanged.emit({
        subHarnessId: this.editingSubHarnessRef.harnessId,
        data: this.editingChildHarness.harnessData
      });
    }

    this.editingSubHarnessId.set(null);
    this.editingSubHarnessRef = null;
    this.editingChildHarness = null;

    // Clear selection
    this.clearSelection();
    this.clearMultiSelection();

    // Notify parent component
    this.subHarnessEditModeChanged.emit(false);

    this.render();
  }

  /**
   * Transform a point from parent canvas coordinates to sub-harness local coordinates
   */
  private transformToSubHarnessLocal(x: number, y: number, subRef: SubHarnessRef): { x: number; y: number } {
    const sx = subRef.position?.x || 0;
    const sy = subRef.position?.y || 0;
    const rotation = subRef.rotation || 0;
    const flipped = subRef.flipped || false;

    // Translate relative to sub-harness origin
    let localX = x - sx;
    let localY = y - sy;

    // Reverse rotation
    if (rotation !== 0) {
      const rad = (-rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rotX = localX * cos - localY * sin;
      const rotY = localX * sin + localY * cos;
      localX = rotX;
      localY = rotY;
    }

    // Reverse flip
    if (flipped) {
      localX = -localX;
    }

    return { x: localX, y: localY };
  }

  /**
   * Transform a point from sub-harness local coordinates to parent canvas coordinates
   */
  private transformFromSubHarnessLocal(x: number, y: number, subRef: SubHarnessRef): { x: number; y: number } {
    const sx = subRef.position?.x || 0;
    const sy = subRef.position?.y || 0;
    const rotation = subRef.rotation || 0;
    const flipped = subRef.flipped || false;

    let worldX = x;
    let worldY = y;

    // Apply flip
    if (flipped) {
      worldX = -worldX;
    }

    // Apply rotation
    if (rotation !== 0) {
      const rad = (rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rotX = worldX * cos - worldY * sin;
      const rotY = worldX * sin + worldY * cos;
      worldX = rotX;
      worldY = rotY;
    }

    // Translate to parent coordinates
    worldX += sx;
    worldY += sy;

    return { x: worldX, y: worldY };
  }

  /**
   * Check if currently in sub-harness edit mode
   */
  isInSubHarnessEditMode(): boolean {
    return this.editingSubHarnessId() !== null;
  }

  /**
   * Clear selection state
   */
  private clearSelection(): void {
    this.selectedConnectorId = null;
    this.selectedConnectionId = null;
    this.selectedCableId = null;
    this.selectedComponentId = null;
    this.selectedSubHarnessId = null;
    this.selectionChanged.emit({ type: 'none' });
  }

  /**
   * Emit dragStart if not already emitted for this drag operation (for undo/redo)
   */
  private emitDragStartOnce(): void {
    if (!this.dragStartEmitted) {
      this.dragStartEmitted = true;
      this.dragStart.emit();
    }
  }

  /**
   * Emit dragEnd if dragStart was emitted (for undo/redo)
   */
  private emitDragEndIfStarted(): void {
    if (this.dragStartEmitted) {
      this.dragStartEmitted = false;
      this.dragEnd.emit();
    }
  }

  /**
   * Add a control point (waypoint) to a wire at the specified position
   */
  private addWireControlPoint(connectionId: string, fromPos: { x: number; y: number }, toPos: { x: number; y: number }, clickX: number, clickY: number): void {
    const data = this.harnessData();
    if (!data) return;

    const connection = data.connections.find(c => c.id === connectionId);
    if (!connection) return;

    // Find where to insert the new waypoint
    const result = findWaypointInsertIndex(connection, fromPos, toPos, clickX, clickY, this.gridSize());

    // Snap the new point to grid
    const newPoint = {
      x: true ? Math.round(result.point.x / this.gridSize()) * this.gridSize() : result.point.x,
      y: true ? Math.round(result.point.y / this.gridSize()) * this.gridSize() : result.point.y
    };

    // Get current waypoints or calculate from orthogonal path
    let waypoints = connection.waypoints ? [...connection.waypoints] : [];

    // If no waypoints exist yet, we need to convert the auto-calculated path to waypoints
    if (waypoints.length === 0) {
      const autoPath = calculateOrthogonalPath(fromPos, toPos, this.gridSize());
      // Exclude the first and last points (from/to positions)
      waypoints = autoPath.slice(1, -1);
    }

    // Insert the new point at the correct position
    waypoints.splice(result.index, 0, newPoint);

    // Update the connection
    const connections = data.connections.map(c =>
      c.id === connectionId
        ? { ...c, waypoints }
        : c
    );

    this.dataChanged.emit({ ...data, connections });
    this.render();
  }

  /**
   * Remove a control point (waypoint) from a wire
   */
  private removeWireControlPoint(connectionId: string, pointIndex: number): void {
    const data = this.harnessData();
    if (!data) return;

    const connection = data.connections.find(c => c.id === connectionId);
    if (!connection) return;

    const fromPos = this.getConnectionFromPos(data, connection);
    const toPos = this.getConnectionToPos(data, connection);
    if (!fromPos || !toPos) return;

    // Get current waypoints
    let waypoints = connection.waypoints ? [...connection.waypoints] : [];

    // If no explicit waypoints, convert auto-path to waypoints first
    if (waypoints.length === 0) {
      const autoPath = calculateOrthogonalPath(fromPos, toPos, this.gridSize());
      waypoints = autoPath.slice(1, -1);
    }

    // The pointIndex is relative to the full path (including from and to positions)
    // So waypoint index = pointIndex - 1 (since fromPos is at index 0)
    const waypointIndex = pointIndex - 1;

    if (waypointIndex >= 0 && waypointIndex < waypoints.length) {
      waypoints.splice(waypointIndex, 1);

      // Update the connection
      const connections = data.connections.map(c =>
        c.id === connectionId
          ? { ...c, waypoints: waypoints.length > 0 ? waypoints : undefined }
          : c
      );

      this.dataChanged.emit({ ...data, connections });
      this.render();
    }
  }

  /**
   * Add a control point to a wire in a child harness (sub-harness edit mode)
   */
  private addChildWireControlPoint(
    childData: HarnessData,
    harnessId: number,
    connectionId: string,
    fromPos: { x: number; y: number },
    toPos: { x: number; y: number },
    clickX: number,
    clickY: number
  ): void {
    const connection = (childData.connections || []).find(c => c.id === connectionId);
    if (!connection) return;

    // Find where to insert the new waypoint
    const result = findWaypointInsertIndex(connection, fromPos, toPos, clickX, clickY, this.gridSize());

    // Snap the new point to grid
    const newPoint = {
      x: true ? Math.round(result.point.x / this.gridSize()) * this.gridSize() : result.point.x,
      y: true ? Math.round(result.point.y / this.gridSize()) * this.gridSize() : result.point.y
    };

    // Get current waypoints or calculate from orthogonal path
    let waypoints = connection.waypoints ? [...connection.waypoints] : [];

    // If no waypoints exist yet, we need to convert the auto-calculated path to waypoints
    if (waypoints.length === 0) {
      const autoPath = calculateOrthogonalPath(fromPos, toPos, this.gridSize());
      // Exclude the first and last points (from/to positions)
      waypoints = autoPath.slice(1, -1);
    }

    // Insert the new point at the correct position
    waypoints.splice(result.index, 0, newPoint);

    // Update the connection immutably
    const updatedConnections = (childData.connections || []).map(c =>
      c.id === connectionId
        ? { ...c, waypoints }
        : c
    );

    this.editingChildHarness!.harnessData = {
      ...childData,
      connections: updatedConnections
    };
    this.subHarnessDataCache.set(harnessId, this.editingChildHarness!);

    // Emit the change
    this.subHarnessDataChanged.emit({
      subHarnessId: harnessId,
      data: this.editingChildHarness!.harnessData
    });
    this.render();
  }

  /**
   * Remove a control point from a wire in a child harness (sub-harness edit mode)
   */
  private removeChildWireControlPoint(
    childData: HarnessData,
    harnessId: number,
    connectionId: string,
    fromPos: { x: number; y: number },
    toPos: { x: number; y: number },
    pointIndex: number
  ): void {
    const connection = (childData.connections || []).find(c => c.id === connectionId);
    if (!connection) return;

    // Get current waypoints
    let waypoints = connection.waypoints ? [...connection.waypoints] : [];

    // If no explicit waypoints, convert auto-path to waypoints first
    if (waypoints.length === 0) {
      const autoPath = calculateOrthogonalPath(fromPos, toPos, this.gridSize());
      waypoints = autoPath.slice(1, -1);
    }

    // The pointIndex is relative to the full path (including from and to positions)
    // So waypoint index = pointIndex - 1 (since fromPos is at index 0)
    const waypointIndex = pointIndex - 1;

    if (waypointIndex >= 0 && waypointIndex < waypoints.length) {
      waypoints.splice(waypointIndex, 1);

      // Update the connection immutably
      const updatedConnections = (childData.connections || []).map(c =>
        c.id === connectionId
          ? { ...c, waypoints: waypoints.length > 0 ? waypoints : undefined }
          : c
      );

      this.editingChildHarness!.harnessData = {
        ...childData,
        connections: updatedConnections
      };
      this.subHarnessDataCache.set(harnessId, this.editingChildHarness!);

      // Emit the change
      this.subHarnessDataChanged.emit({
        subHarnessId: harnessId,
        data: this.editingChildHarness!.harnessData
      });
      this.render();
    }
  }

  /**
   * Draw overlay/indicator for sub-harness edit mode
   */
  private drawSubHarnessEditModeOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.editingSubHarnessRef || !this.editingChildHarness) return;

    const subRef = this.editingSubHarnessRef;
    const childHarness = this.editingChildHarness;
    const dims = getSubHarnessDimensions(subRef, childHarness);

    // Draw a subtle highlight border around the editing sub-harness
    ctx.save();
    ctx.translate(subRef.position?.x || 0, subRef.position?.y || 0);
    ctx.rotate(((subRef.rotation || 0) * Math.PI) / 180);
    if (subRef.flipped) {
      ctx.scale(-1, 1);
    }

    // Draw edit mode indicator border (bright cyan)
    ctx.strokeStyle = '#00bcd4';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    const padding = 5;
    ctx.strokeRect(
      dims.bounds.minX - padding,
      dims.bounds.minY - padding,
      dims.bounds.maxX - dims.bounds.minX + padding * 2,
      dims.bounds.maxY - dims.bounds.minY + padding * 2
    );

    // Draw "Editing" label
    ctx.fillStyle = '#00bcd4';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const labelText = `Editing: ${childHarness.name}`;
    ctx.fillText(labelText, dims.bounds.minX - padding, dims.bounds.minY - padding - 4);

    // Draw "Press ESC to exit" hint
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#888888';
    ctx.fillText('Press ESC to exit edit mode', dims.bounds.minX - padding, dims.bounds.maxY + padding + 14);

    ctx.restore();
  }

  /**
   * Handle keyboard events
   */
  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Exit sub-harness edit mode on Escape
    if (event.key === 'Escape' && this.editingSubHarnessId()) {
      this.exitSubHarnessEditMode();
      event.preventDefault();
      return;
    }

    // Delete selected elements (only in edit mode for sub-harness children)
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.editingSubHarnessId()) {
      // TODO: Handle deletion of sub-harness child elements
      event.preventDefault();
      return;
    }

    // Ctrl+A to select all elements
    if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
      const data = this.harnessData();
      if (!data) return;

      // Clear existing selection
      this.selectedIds.clear();
      this.selectedConnectorId = null;
      this.selectedCableId = null;
      this.selectedComponentId = null;
      this.selectedSubHarnessId = null;
      this.selectedConnectionId = null;

      // Add all elements to selection
      for (const connector of data.connectors) {
        this.selectedIds.add(`connector:${connector.id}`);
      }
      for (const cable of data.cables) {
        this.selectedIds.add(`cable:${cable.id}`);
      }
      for (const component of (data.components || [])) {
        this.selectedIds.add(`component:${component.id}`);
      }
      for (const subHarness of (data.subHarnesses || [])) {
        this.selectedIds.add(`subHarness:${subHarness.id}`);
      }
      for (const connection of data.connections) {
        this.selectedIds.add(`connection:${connection.id}`);
      }

      this.selectionChanged.emit({
        type: 'multiple',
        selectedIds: Array.from(this.selectedIds).map(s => {
          const [type, id] = s.split(':');
          return { type, id };
        })
      });
      this.render();
      event.preventDefault();
      return;
    }

    // Delete/Backspace to delete selected elements
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const hasSelection = this.selectedIds.size > 0 ||
        this.selectedConnectorId ||
        this.selectedCableId ||
        this.selectedComponentId ||
        this.selectedSubHarnessId ||
        this.selectedConnectionId;

      if (hasSelection) {
        this.deleteSelected();
        event.preventDefault();
        return;
      }
    }

    // Arrow keys move selected elements by 1 grid space
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      const data = this.harnessData();
      if (!data) return;

      const gridSize = this.gridSize();
      let dx = 0, dy = 0;
      switch (event.key) {
        case 'ArrowUp': dy = -gridSize; break;
        case 'ArrowDown': dy = gridSize; break;
        case 'ArrowLeft': dx = -gridSize; break;
        case 'ArrowRight': dx = gridSize; break;
      }

      let moved = false;
      const snap = (val: number) => Math.round(val / gridSize) * gridSize;

      // Move selected connector
      if (this.selectedConnectorId) {
        const connector = data.connectors.find(c => c.id === this.selectedConnectorId);
        if (connector && connector.position) {
          connector.position.x = snap(connector.position.x + dx);
          connector.position.y = snap(connector.position.y + dy);
          this.connectorMoved.emit({ connector, x: connector.position.x, y: connector.position.y });
          moved = true;
        }
      }

      // Move selected cable
      if (this.selectedCableId) {
        const cable = data.cables.find(c => c.id === this.selectedCableId);
        if (cable && cable.position) {
          cable.position.x = snap(cable.position.x + dx);
          cable.position.y = snap(cable.position.y + dy);
          this.cableMoved.emit({ cable, x: cable.position.x, y: cable.position.y });
          moved = true;
        }
      }

      // Move selected component
      if (this.selectedComponentId) {
        const component = (data.components || []).find(c => c.id === this.selectedComponentId);
        if (component && component.position) {
          component.position.x = snap(component.position.x + dx);
          component.position.y = snap(component.position.y + dy);
          this.componentMoved.emit({ component, x: component.position.x, y: component.position.y });
          moved = true;
        }
      }

      // Move selected sub-harness
      if (this.selectedSubHarnessId) {
        const subHarness = (data.subHarnesses || []).find(s => s.id === this.selectedSubHarnessId);
        if (subHarness && subHarness.position) {
          subHarness.position.x = snap(subHarness.position.x + dx);
          subHarness.position.y = snap(subHarness.position.y + dy);
          moved = true;
        }
      }

      // Move all elements in multi-selection
      if (this.selectedIds.size > 0) {
        for (const key of this.selectedIds) {
          const [type, id] = key.split(':');
          if (type === 'connector') {
            const connector = data.connectors.find(c => c.id === id);
            if (connector?.position) {
              connector.position.x = snap(connector.position.x + dx);
              connector.position.y = snap(connector.position.y + dy);
            }
          } else if (type === 'cable') {
            const cable = data.cables.find(c => c.id === id);
            if (cable?.position) {
              cable.position.x = snap(cable.position.x + dx);
              cable.position.y = snap(cable.position.y + dy);
            }
          } else if (type === 'component') {
            const component = (data.components || []).find(c => c.id === id);
            if (component?.position) {
              component.position.x = snap(component.position.x + dx);
              component.position.y = snap(component.position.y + dy);
            }
          } else if (type === 'subHarness') {
            const subHarness = (data.subHarnesses || []).find(s => s.id === id);
            if (subHarness?.position) {
              subHarness.position.x = snap(subHarness.position.x + dx);
              subHarness.position.y = snap(subHarness.position.y + dy);
            }
          }
        }
        moved = true;
      }

      if (moved) {
        this.dataChanged.emit(data);
        this.render();
        event.preventDefault();
      }
    }
  }

  /**
   * Handle mouse down events when in sub-harness edit mode
   */
  private handleSubHarnessEditModeMouseDown(event: MouseEvent, x: number, y: number): void {
    if (!this.editingSubHarnessRef || !this.editingChildHarness) return;

    const subRef = this.editingSubHarnessRef;
    const childHarness = this.editingChildHarness;
    const childData = childHarness.harnessData;

    // Transform click to sub-harness local coordinates
    const localPoint = this.transformToSubHarnessLocal(x, y, subRef);

    // Check if click is outside the sub-harness bounds - exit edit mode
    const dims = getSubHarnessDimensions(subRef, childHarness);
    if (localPoint.x < dims.bounds.minX - 20 || localPoint.x > dims.bounds.maxX + 20 ||
      localPoint.y < dims.bounds.minY - 20 || localPoint.y > dims.bounds.maxY + 20) {
      this.exitSubHarnessEditMode();
      return;
    }

    // Node Edit tool - click on control points to drag them (within sub-harness)
    if (this.activeTool() === 'nodeEdit') {
      // Check all wires (including mating) for control point hits
      for (const connection of childData.connections || []) {
        const fromPos = this.getChildConnectionFromPos(childData, connection);
        const toPos = this.getChildConnectionToPos(childData, connection);
        if (!fromPos || !toPos) continue;

        const cpIndex = hitTestWireControlPoint(connection, fromPos, toPos, localPoint.x, localPoint.y, this.gridSize());
        if (cpIndex >= 0) {
          // Start dragging this control point
          this.isDraggingControlPoint = true;
          this.draggedConnectionId = connection.id;
          this.draggedControlPointIndex = cpIndex;
          this.selectedConnectionId = connection.id;
          this.emitDragStartOnce();
          this.selectionChanged.emit({ type: 'wire', connection });
          return;
        }
      }
      // If not clicking on a control point, select the wire if clicking on it
      for (const connection of childData.connections || []) {
        const fromPos = this.getChildConnectionFromPos(childData, connection);
        const toPos = this.getChildConnectionToPos(childData, connection);
        if (!fromPos || !toPos) continue;

        if (hitTestWire(connection, fromPos, toPos, localPoint.x, localPoint.y, this.gridSize())) {
          this.selectedConnectionId = connection.id;
          this.selectedConnectorId = null;
          this.selectedCableId = null;
          this.selectedComponentId = null;
          this.selectionChanged.emit({ type: 'wire', connection });
          return;
        }
      }
      // Clicked on nothing - clear selection
      this.clearSelection();
      this.selectionChanged.emit({ type: 'none' });
      return;
    }

    // Wire drawing tool - check connector pins, cable wire endpoints, and component pins
    if (this.activeTool() === 'wire') {
      // Check for child connector pin clicks (for wire drawing)
      for (const connector of childData.connectors || []) {
        const pinHit = hitTestConnectorPinWithSide(connector, localPoint.x, localPoint.y);
        if (pinHit) {
          // Start wire drawing within sub-harness
          this.isDrawingWire = true;
          this.isDrawingMatingWire = pinHit.side === 'mating';
          this.wireStartConnectorId = connector.id;
          this.wireStartPinId = pinHit.pinId;
          this.wireStartCableId = null;
          this.wireStartWireId = null;
          this.wireStartSide = null;
          this.wireStartComponentId = null;
          this.wireStartComponentPinId = null;
          this.wireStartSubHarnessId = null;
          this.wireStartSubHarnessConnectorId = null;
          this.wireEndX = x;
          this.wireEndY = y;
          return;
        }
      }
      // Check for child cable wire endpoint clicks
      for (const cable of childData.cables || []) {
        if (!cable.position) continue;
        const hit = hitTestCableWire(cable, localPoint.x, localPoint.y);
        if (hit) {
          this.isDrawingWire = true;
          this.wireStartCableId = cable.id;
          this.wireStartWireId = hit.wireId;
          this.wireStartSide = hit.side;
          this.wireStartConnectorId = null;
          this.wireStartPinId = null;
          this.wireStartComponentId = null;
          this.wireStartComponentPinId = null;
          this.wireStartSubHarnessId = null;
          this.wireStartSubHarnessConnectorId = null;
          this.wireEndX = x;
          this.wireEndY = y;
          return;
        }
      }
      // Check for child component pin clicks
      for (const component of childData.components || []) {
        const hit = hitTestComponentPin(component, localPoint.x, localPoint.y);
        if (hit) {
          this.isDrawingWire = true;
          this.wireStartComponentId = component.id;
          this.wireStartComponentPinId = hit.pinId;
          this.wireStartConnectorId = null;
          this.wireStartPinId = null;
          this.wireStartCableId = null;
          this.wireStartWireId = null;
          this.wireStartSide = null;
          this.wireStartSubHarnessId = null;
          this.wireStartSubHarnessConnectorId = null;
          this.wireEndX = x;
          this.wireEndY = y;
          return;
        }
      }
      return;
    }

    // Select tool - first check pin clicks to start wire drawing
    for (const connector of childData.connectors || []) {
      const pinHit = hitTestConnectorPinWithSide(connector, localPoint.x, localPoint.y);
      if (pinHit) {
        // Start wire drawing within sub-harness
        this.isDrawingWire = true;
        this.isDrawingMatingWire = pinHit.side === 'mating';
        this.wireStartConnectorId = connector.id;
        this.wireStartPinId = pinHit.pinId;
        this.wireStartCableId = null;
        this.wireStartWireId = null;
        this.wireStartSide = null;
        this.wireStartComponentId = null;
        this.wireStartComponentPinId = null;
        this.wireStartSubHarnessId = null;
        this.wireStartSubHarnessConnectorId = null;
        this.wireEndX = x;
        this.wireEndY = y;
        return;
      }
    }

    // Check cable wire endpoints
    for (const cable of childData.cables || []) {
      if (!cable.position) continue;
      const hit = hitTestCableWire(cable, localPoint.x, localPoint.y);
      if (hit) {
        this.isDrawingWire = true;
        this.wireStartCableId = cable.id;
        this.wireStartWireId = hit.wireId;
        this.wireStartSide = hit.side;
        this.wireStartConnectorId = null;
        this.wireStartPinId = null;
        this.wireStartComponentId = null;
        this.wireStartComponentPinId = null;
        this.wireStartSubHarnessId = null;
        this.wireStartSubHarnessConnectorId = null;
        this.wireEndX = x;
        this.wireEndY = y;
        return;
      }
    }

    // Check component pins
    for (const component of childData.components || []) {
      const hit = hitTestComponentPin(component, localPoint.x, localPoint.y);
      if (hit) {
        this.isDrawingWire = true;
        this.wireStartComponentId = component.id;
        this.wireStartComponentPinId = hit.pinId;
        this.wireStartConnectorId = null;
        this.wireStartPinId = null;
        this.wireStartCableId = null;
        this.wireStartWireId = null;
        this.wireStartSide = null;
        this.wireStartSubHarnessId = null;
        this.wireStartSubHarnessConnectorId = null;
        this.wireEndX = x;
        this.wireEndY = y;
        return;
      }
    }

    // Check for selection of child elements
    // Check connectors
    for (const connector of childData.connectors || []) {
      if (hitTestConnector(connector, localPoint.x, localPoint.y)) {
        this.selectedConnectorId = connector.id;
        this.selectedCableId = null;
        this.selectedComponentId = null;
        this.selectedConnectionId = null;
        this.selectionChanged.emit({ type: 'connector', connector });

        // Start dragging (use local coordinates for offset)
        this.isDragging = true;
        this.dragStartX = localPoint.x;
        this.dragStartY = localPoint.y;
        this.dragOffsetX = localPoint.x - (connector.position?.x || 0);
        this.dragOffsetY = localPoint.y - (connector.position?.y || 0);
        this.emitDragStartOnce();
        return;
      }
    }

    // Check cables
    for (const cable of childData.cables || []) {
      if (cable.position && hitTestCable(cable, localPoint.x, localPoint.y)) {
        this.selectedCableId = cable.id;
        this.selectedConnectorId = null;
        this.selectedComponentId = null;
        this.selectedConnectionId = null;
        this.selectionChanged.emit({ type: 'cable', cable });

        // Start dragging (use local coordinates for offset)
        this.isDraggingCable = true;
        this.dragStartX = localPoint.x;
        this.dragStartY = localPoint.y;
        this.dragOffsetX = localPoint.x - cable.position.x;
        this.dragOffsetY = localPoint.y - cable.position.y;
        this.emitDragStartOnce();
        return;
      }
    }

    // Check components
    for (const component of childData.components || []) {
      if (hitTestComponent(component, localPoint.x, localPoint.y)) {
        this.selectedComponentId = component.id;
        this.selectedConnectorId = null;
        this.selectedCableId = null;
        this.selectedConnectionId = null;
        this.selectionChanged.emit({ type: 'component', component });

        // Start dragging (use local coordinates for offset)
        this.isDraggingComponent = true;
        this.dragStartX = localPoint.x;
        this.dragStartY = localPoint.y;
        this.dragOffsetX = localPoint.x - (component.position?.x || 0);
        this.dragOffsetY = localPoint.y - (component.position?.y || 0);
        this.emitDragStartOnce();
        return;
      }
    }

    // Check wires within sub-harness
    for (const connection of childData.connections || []) {
      const fromPos = this.getChildConnectionFromPos(childData, connection);
      const toPos = this.getChildConnectionToPos(childData, connection);

      if (fromPos && toPos && hitTestWire(connection, fromPos, toPos, localPoint.x, localPoint.y, this.gridSize())) {
        this.selectedConnectionId = connection.id;
        this.selectedConnectorId = null;
        this.selectedCableId = null;
        this.selectedComponentId = null;
        this.selectionChanged.emit({ type: 'wire', connection });
        this.render();
        return;
      }
    }

    // Clicked on empty space within sub-harness - clear selection
    this.clearSelection();
    this.render();
  }

  /**
   * Get connection from position for a child harness
   */
  private getChildConnectionFromPos(data: HarnessData, connection: HarnessConnection): { x: number; y: number } | null {
    if (connection.fromConnector && connection.fromPin) {
      const fromConnector = data.connectors.find(c => c.id === connection.fromConnector);
      if (fromConnector) {
        const isMating = connection.connectionType === 'mating';
        const pins = getConnectorPinPositions(fromConnector, isMating ? 'mating' : 'wire');
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

  /**
   * Get connection to position for a child harness
   */
  private getChildConnectionToPos(data: HarnessData, connection: HarnessConnection): { x: number; y: number } | null {
    if (connection.toConnector && connection.toPin) {
      const toConnector = data.connectors.find(c => c.id === connection.toConnector);
      if (toConnector) {
        const isMating = connection.connectionType === 'mating';
        const pins = getConnectorPinPositions(toConnector, isMating ? 'mating' : 'wire');
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

  /**
   * Handle mouse move in sub-harness edit mode
   */
  private handleSubHarnessEditModeMouseMove(event: MouseEvent, x: number, y: number): void {
    if (!this.editingSubHarnessRef || !this.editingChildHarness) return;

    const subRef = this.editingSubHarnessRef;
    const childData = this.editingChildHarness.harnessData;
    const localPoint = this.transformToSubHarnessLocal(x, y, subRef);

    // Handle wire drawing
    if (this.isDrawingWire) {
      this.wireEndX = x;
      this.wireEndY = y;

      // Track hovered pins in child harness
      this.hoveredPinConnectorId = null;
      this.hoveredPinId = null;
      this.hoveredMatingPinConnectorId = null;
      this.hoveredMatingPinId = null;
      this.hoveredCableId = null;
      this.hoveredCableWireId = null;
      this.hoveredCableSide = null;
      this.hoveredComponentId = null;
      this.hoveredComponentPinId = null;

      if (this.isDrawingMatingWire) {
        for (const connector of childData.connectors || []) {
          if (connector.id === this.wireStartConnectorId) continue;
          const pinHit = hitTestConnectorPinWithSide(connector, localPoint.x, localPoint.y);
          if (pinHit && pinHit.side === 'mating') {
            this.hoveredMatingPinConnectorId = connector.id;
            this.hoveredMatingPinId = pinHit.pinId;
            break;
          }
        }
      } else {
        // Check connector wire pins
        for (const connector of childData.connectors || []) {
          if (connector.id === this.wireStartConnectorId) continue;
          const pinHit = hitTestConnectorPinWithSide(connector, localPoint.x, localPoint.y);
          if (pinHit && pinHit.side === 'wire') {
            this.hoveredPinConnectorId = connector.id;
            this.hoveredPinId = pinHit.pinId;
            break;
          }
        }
        // Check cable wire endpoints
        if (!this.hoveredPinConnectorId) {
          for (const cable of childData.cables || []) {
            if (!cable.position || cable.id === this.wireStartCableId) continue;
            const hit = hitTestCableWire(cable, localPoint.x, localPoint.y);
            if (hit) {
              this.hoveredCableId = cable.id;
              this.hoveredCableWireId = hit.wireId;
              this.hoveredCableSide = hit.side;
              break;
            }
          }
        }
        // Check component pins
        if (!this.hoveredPinConnectorId && !this.hoveredCableId) {
          for (const component of childData.components || []) {
            if (component.id === this.wireStartComponentId) continue;
            const hit = hitTestComponentPin(component, localPoint.x, localPoint.y);
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

    // Handle dragging control point in sub-harness
    if (this.isDraggingControlPoint && this.draggedConnectionId) {
      const connection = (childData.connections || []).find(c => c.id === this.draggedConnectionId);
      if (connection) {
        const fromPos = this.getChildConnectionFromPos(childData, connection);
        const toPos = this.getChildConnectionToPos(childData, connection);
        if (fromPos && toPos) {
          // Snap to grid if enabled
          let newX = localPoint.x;
          let newY = localPoint.y;
          if (true) {
            newX = Math.round(newX / this.gridSize()) * this.gridSize();
            newY = Math.round(newY / this.gridSize()) * this.gridSize();
          }

          // Get current waypoints or calculate from orthogonal path
          let waypoints = connection.waypoints ? [...connection.waypoints] : [];
          if (waypoints.length === 0) {
            const autoPath = calculateOrthogonalPath(fromPos, toPos, this.gridSize());
            waypoints = autoPath.slice(1, -1);
          }

          // Update the waypoint at the dragged index
          const waypointIndex = this.draggedControlPointIndex - 1;
          if (waypointIndex >= 0 && waypointIndex < waypoints.length) {
            waypoints[waypointIndex] = { x: newX, y: newY };

            // Update the connection immutably
            const updatedConnections = (childData.connections || []).map(c =>
              c.id === this.draggedConnectionId
                ? { ...c, waypoints: waypoints.length > 0 ? waypoints : undefined }
                : c
            );
            this.editingChildHarness!.harnessData = {
              ...childData,
              connections: updatedConnections
            };
            this.subHarnessDataCache.set(subRef.harnessId, this.editingChildHarness!);
          }

          this.render();
        }
      }
      return;
    }

    // Handle dragging connector (use local coordinates)
    if (this.isDragging && this.selectedConnectorId) {
      let newX = localPoint.x - this.dragOffsetX;
      let newY = localPoint.y - this.dragOffsetY;
      if (true) {
        newX = Math.round(newX / this.gridSize()) * this.gridSize();
        newY = Math.round(newY / this.gridSize()) * this.gridSize();
      }

      // Update connector position immutably to ensure render picks up changes
      const updatedConnectors = childData.connectors.map(c =>
        c.id === this.selectedConnectorId
          ? { ...c, position: { x: newX, y: newY } }
          : c
      );

      this.editingChildHarness!.harnessData = {
        ...childData,
        connectors: updatedConnectors
      };
      // Also update the cache to keep them in sync
      this.subHarnessDataCache.set(subRef.harnessId, this.editingChildHarness!);

      this.render();
      return;
    }

    // Handle dragging cable (use local coordinates)
    if (this.isDraggingCable && this.selectedCableId) {
      const cable = childData.cables.find(c => c.id === this.selectedCableId);
      if (cable && cable.position) {
        let newX = localPoint.x - this.dragOffsetX;
        let newY = localPoint.y - this.dragOffsetY;
        if (true) {
          newX = Math.round(newX / this.gridSize()) * this.gridSize();
          newY = Math.round(newY / this.gridSize()) * this.gridSize();
        }

        // Update cable position immutably
        const updatedCables = childData.cables.map(c =>
          c.id === this.selectedCableId
            ? { ...c, position: { x: newX, y: newY } }
            : c
        );
        this.editingChildHarness!.harnessData = {
          ...childData,
          cables: updatedCables
        };
        this.subHarnessDataCache.set(subRef.harnessId, this.editingChildHarness!);

        this.render();
      }
      return;
    }

    // Handle dragging component (use local coordinates)
    if (this.isDraggingComponent && this.selectedComponentId) {
      const component = childData.components?.find(c => c.id === this.selectedComponentId);
      if (component) {
        let newX = localPoint.x - this.dragOffsetX;
        let newY = localPoint.y - this.dragOffsetY;
        if (true) {
          newX = Math.round(newX / this.gridSize()) * this.gridSize();
          newY = Math.round(newY / this.gridSize()) * this.gridSize();
        }

        // Update component position immutably
        const updatedComponents = (childData.components || []).map(c =>
          c.id === this.selectedComponentId
            ? { ...c, position: { x: newX, y: newY } }
            : c
        );
        this.editingChildHarness!.harnessData = {
          ...childData,
          components: updatedComponents
        };
        this.subHarnessDataCache.set(subRef.harnessId, this.editingChildHarness!);

        this.render();
      }
      return;
    }

    // Update cursor
    this.canvasRef.nativeElement.style.cursor = 'default';
  }

  /**
   * Handle mouse up in sub-harness edit mode
   */
  private handleSubHarnessEditModeMouseUp(event: MouseEvent): void {
    if (!this.editingSubHarnessRef || !this.editingChildHarness) return;

    const { x, y } = this.screenToCanvas(event.clientX, event.clientY);
    const subRef = this.editingSubHarnessRef;
    const childData = this.editingChildHarness.harnessData;
    const localPoint = this.transformToSubHarnessLocal(x, y, subRef);

    // End wire drawing
    if (this.isDrawingWire) {
      let connectionCreated = false;

      if (this.isDrawingMatingWire) {
        // Check for mating pin connection in child harness
        for (const connector of childData.connectors || []) {
          if (connector.id === this.wireStartConnectorId) continue;
          const pinHit = hitTestConnectorPinWithSide(connector, localPoint.x, localPoint.y);
          if (pinHit && pinHit.side === 'mating') {
            const newConnection: HarnessConnection = {
              id: `conn-${Date.now()}`,
              connectionType: 'mating',
              fromConnector: this.wireStartConnectorId || undefined,
              fromPin: this.wireStartPinId || undefined,
              toConnector: connector.id,
              toPin: pinHit.pinId
            };
            childData.connections = [...(childData.connections || []), newConnection];
            connectionCreated = true;
            break;
          }
        }
      } else {
        // Check for wire pin connection
        for (const connector of childData.connectors || []) {
          if (connector.id === this.wireStartConnectorId) continue;
          const pinHit = hitTestConnectorPinWithSide(connector, localPoint.x, localPoint.y);
          if (pinHit && pinHit.side === 'wire') {
            const newConnection: HarnessConnection = {
              id: `conn-${Date.now()}`,
              fromConnector: this.wireStartConnectorId || undefined,
              fromPin: this.wireStartPinId || undefined,
              fromCable: this.wireStartCableId || undefined,
              fromWire: this.wireStartWireId || undefined,
              fromSide: this.wireStartSide || undefined,
              fromComponent: this.wireStartComponentId || undefined,
              fromComponentPin: this.wireStartComponentPinId || undefined,
              toConnector: connector.id,
              toPin: pinHit.pinId
            };
            childData.connections = [...(childData.connections || []), newConnection];
            connectionCreated = true;
            break;
          }
        }

        // Check cable endpoints
        if (!connectionCreated) {
          for (const cable of childData.cables || []) {
            if (!cable.position || cable.id === this.wireStartCableId) continue;
            const hit = hitTestCableWire(cable, localPoint.x, localPoint.y);
            if (hit) {
              const newConnection: HarnessConnection = {
                id: `conn-${Date.now()}`,
                fromConnector: this.wireStartConnectorId || undefined,
                fromPin: this.wireStartPinId || undefined,
                fromCable: this.wireStartCableId || undefined,
                fromWire: this.wireStartWireId || undefined,
                fromSide: this.wireStartSide || undefined,
                fromComponent: this.wireStartComponentId || undefined,
                fromComponentPin: this.wireStartComponentPinId || undefined,
                toCable: cable.id,
                toWire: hit.wireId,
                toSide: hit.side
              };
              childData.connections = [...(childData.connections || []), newConnection];
              connectionCreated = true;
              break;
            }
          }
        }

        // Check component pins
        if (!connectionCreated) {
          for (const component of childData.components || []) {
            if (component.id === this.wireStartComponentId) continue;
            const hit = hitTestComponentPin(component, localPoint.x, localPoint.y);
            if (hit) {
              const newConnection: HarnessConnection = {
                id: `conn-${Date.now()}`,
                fromConnector: this.wireStartConnectorId || undefined,
                fromPin: this.wireStartPinId || undefined,
                fromCable: this.wireStartCableId || undefined,
                fromWire: this.wireStartWireId || undefined,
                fromSide: this.wireStartSide || undefined,
                fromComponent: this.wireStartComponentId || undefined,
                fromComponentPin: this.wireStartComponentPinId || undefined,
                toComponent: component.id,
                toComponentPin: hit.pinId
              };
              childData.connections = [...(childData.connections || []), newConnection];
              connectionCreated = true;
              break;
            }
          }
        }
      }

      // Emit change if connection was created
      if (connectionCreated) {
        this.subHarnessDataChanged.emit({
          subHarnessId: subRef.harnessId,
          data: childData
        });
      }

      // Reset wire drawing state
      this.isDrawingWire = false;
      this.isDrawingMatingWire = false;
      this.wireStartConnectorId = null;
      this.wireStartPinId = null;
      this.wireStartCableId = null;
      this.wireStartWireId = null;
      this.wireStartSide = null;
      this.wireStartComponentId = null;
      this.wireStartComponentPinId = null;
      this.hoveredPinConnectorId = null;
      this.hoveredPinId = null;
      this.hoveredMatingPinConnectorId = null;
      this.hoveredMatingPinId = null;
      this.hoveredCableId = null;
      this.hoveredCableWireId = null;
      this.hoveredCableSide = null;
      this.hoveredComponentId = null;
      this.hoveredComponentPinId = null;

      this.render();
      return;
    }

    // End control point dragging
    if (this.isDraggingControlPoint) {
      this.isDraggingControlPoint = false;
      this.draggedConnectionId = null;
      this.draggedControlPointIndex = -1;

      // Emit the updated child harness data
      this.subHarnessDataChanged.emit({
        subHarnessId: subRef.harnessId,
        data: childData
      });

      this.render();
      return;
    }

    // End dragging - emit changes to sub-harness data
    if (this.isDragging || this.isDraggingCable || this.isDraggingComponent) {
      this.isDragging = false;
      this.isDraggingCable = false;
      this.isDraggingComponent = false;

      // Emit the updated child harness data
      this.subHarnessDataChanged.emit({
        subHarnessId: subRef.harnessId,
        data: childData
      });

      this.render();
    }
  }
}
