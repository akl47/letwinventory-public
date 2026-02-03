// Wire Drawing State Manager
// Consolidates all wire drawing state into a single manager class

import {
  WireEndpoint,
  WireDrawingState,
  Point,
  createEmptyWireDrawingState,
  isMatingEndpoint
} from './wire-endpoint';
import { HarnessConnection } from '../../models/harness.model';

/**
 * Manager class for wire drawing state
 * Provides a clean API for starting, updating, and completing wire drawing operations
 */
export class WireDrawingManager {
  private state: WireDrawingState;

  constructor() {
    this.state = createEmptyWireDrawingState();
  }

  /**
   * Get the current drawing state (read-only)
   */
  getState(): Readonly<WireDrawingState> {
    return this.state;
  }

  /**
   * Check if wire drawing is active
   */
  isDrawing(): boolean {
    return this.state.isActive;
  }

  /**
   * Check if drawing a mating connection
   */
  isDrawingMating(): boolean {
    return this.state.isMating;
  }

  /**
   * Get the start endpoint
   */
  getStartEndpoint(): WireEndpoint | null {
    return this.state.startEndpoint;
  }

  /**
   * Get the hovered endpoint
   */
  getHoveredEndpoint(): WireEndpoint | null {
    return this.state.hoveredEndpoint;
  }

  /**
   * Get current mouse position
   */
  getMousePosition(): Point {
    return this.state.currentMousePosition;
  }

  /**
   * Start drawing a wire from the given endpoint
   */
  startDrawing(endpoint: WireEndpoint): void {
    this.state = {
      isActive: true,
      isMating: isMatingEndpoint(endpoint),
      startEndpoint: endpoint,
      hoveredEndpoint: null,
      currentMousePosition: { ...endpoint.position }
    };
  }

  /**
   * Update the current mouse position during drawing
   */
  updateMousePosition(x: number, y: number): void {
    if (!this.state.isActive) return;
    this.state.currentMousePosition = { x, y };
  }

  /**
   * Set the currently hovered endpoint (potential end point)
   */
  setHoveredEndpoint(endpoint: WireEndpoint | null): void {
    if (!this.state.isActive) return;
    this.state.hoveredEndpoint = endpoint;
  }

  /**
   * Complete the wire drawing operation
   * Returns a new HarnessConnection if successfully connected to a valid endpoint
   * Returns null if no valid end endpoint or if cancelled
   */
  completeDrawing(): HarnessConnection | null {
    if (!this.state.isActive || !this.state.startEndpoint || !this.state.hoveredEndpoint) {
      this.reset();
      return null;
    }

    const start = this.state.startEndpoint;
    const end = this.state.hoveredEndpoint;

    // Validate mating connection: both endpoints must be mating type
    if (this.state.isMating) {
      if (!isMatingEndpoint(start) || !isMatingEndpoint(end)) {
        this.reset();
        return null;
      }
    }

    // Create the connection
    const connection = this.createConnection(start, end);

    this.reset();
    return connection;
  }

  /**
   * Cancel the current wire drawing operation
   */
  reset(): void {
    this.state = createEmptyWireDrawingState();
  }

  /**
   * Create a HarnessConnection from two endpoints
   */
  private createConnection(start: WireEndpoint, end: WireEndpoint): HarnessConnection {
    const connection: HarnessConnection = {
      id: `conn-${Date.now()}`,
      connectionType: this.state.isMating ? 'mating' : 'wire'
    };

    // Set from endpoint
    this.setConnectionEndpoint(connection, start, 'from');

    // Set to endpoint
    this.setConnectionEndpoint(connection, end, 'to');

    return connection;
  }

  /**
   * Set connection endpoint fields based on endpoint type
   */
  private setConnectionEndpoint(
    connection: HarnessConnection,
    endpoint: WireEndpoint,
    direction: 'from' | 'to'
  ): void {
    const prefix = direction;

    switch (endpoint.type) {
      case 'connector':
        if (direction === 'from') {
          connection.fromConnector = endpoint.connectorId;
          connection.fromPin = endpoint.pinId;
        } else {
          connection.toConnector = endpoint.connectorId;
          connection.toPin = endpoint.pinId;
        }
        break;

      case 'connectorMating':
        if (direction === 'from') {
          connection.fromConnector = endpoint.connectorId;
          connection.fromPin = endpoint.pinId;
        } else {
          connection.toConnector = endpoint.connectorId;
          connection.toPin = endpoint.pinId;
        }
        break;

      case 'cable':
        if (direction === 'from') {
          connection.fromCable = endpoint.cableId;
          connection.fromWire = endpoint.wireId;
          connection.fromSide = endpoint.side;
        } else {
          connection.toCable = endpoint.cableId;
          connection.toWire = endpoint.wireId;
          connection.toSide = endpoint.side;
        }
        break;

      case 'component':
        if (direction === 'from') {
          connection.fromComponent = endpoint.componentId;
          connection.fromComponentPin = endpoint.pinId;
        } else {
          connection.toComponent = endpoint.componentId;
          connection.toComponentPin = endpoint.pinId;
        }
        break;

      case 'subHarness':
        if (direction === 'from') {
          connection.fromSubHarness = endpoint.subHarnessId;
          connection.fromSubConnector = endpoint.connectorId;
          connection.fromPin = endpoint.pinId;
        } else {
          connection.toSubHarness = endpoint.subHarnessId;
          connection.toSubConnector = endpoint.connectorId;
          connection.toPin = endpoint.pinId;
        }
        break;
    }
  }

  /**
   * Check if a potential end endpoint is valid
   * (not the same element as start, matches mating type, etc.)
   */
  isValidEndEndpoint(endpoint: WireEndpoint): boolean {
    if (!this.state.isActive || !this.state.startEndpoint) return false;

    const start = this.state.startEndpoint;

    // Can't connect to the same element
    if (this.isSameElement(start, endpoint)) {
      return false;
    }

    // For mating connections, both must be mating type
    if (this.state.isMating) {
      return isMatingEndpoint(endpoint);
    }

    // For regular wires, can't connect to mating endpoints
    return !isMatingEndpoint(endpoint);
  }

  /**
   * Check if two endpoints are on the same element
   */
  private isSameElement(a: WireEndpoint, b: WireEndpoint): boolean {
    if (a.type !== b.type) return false;

    switch (a.type) {
      case 'connector':
      case 'connectorMating':
        return a.connectorId === (b as typeof a).connectorId;
      case 'cable':
        return a.cableId === (b as typeof a).cableId;
      case 'component':
        return a.componentId === (b as typeof a).componentId;
      case 'subHarness':
        return a.subHarnessId === (b as typeof a).subHarnessId;
    }
  }

  // ============================================
  // Legacy getters for backward compatibility
  // These can be removed once the canvas is fully refactored
  // ============================================

  /**
   * Get wire start connector ID (legacy)
   */
  getWireStartConnectorId(): string | null {
    const start = this.state.startEndpoint;
    if (!start) return null;
    if (start.type === 'connector' || start.type === 'connectorMating') {
      return start.connectorId;
    }
    return null;
  }

  /**
   * Get wire start pin ID (legacy)
   */
  getWireStartPinId(): string | null {
    const start = this.state.startEndpoint;
    if (!start) return null;
    if (start.type === 'connector' || start.type === 'connectorMating' || start.type === 'subHarness') {
      return start.pinId;
    }
    return null;
  }

  /**
   * Get wire start cable ID (legacy)
   */
  getWireStartCableId(): string | null {
    const start = this.state.startEndpoint;
    if (!start) return null;
    if (start.type === 'cable') {
      return start.cableId;
    }
    return null;
  }

  /**
   * Get wire start wire ID (legacy)
   */
  getWireStartWireId(): string | null {
    const start = this.state.startEndpoint;
    if (!start) return null;
    if (start.type === 'cable') {
      return start.wireId;
    }
    return null;
  }

  /**
   * Get wire start side (legacy)
   */
  getWireStartSide(): 'left' | 'right' | null {
    const start = this.state.startEndpoint;
    if (!start) return null;
    if (start.type === 'cable') {
      return start.side;
    }
    return null;
  }

  /**
   * Get wire start component ID (legacy)
   */
  getWireStartComponentId(): string | null {
    const start = this.state.startEndpoint;
    if (!start) return null;
    if (start.type === 'component') {
      return start.componentId;
    }
    return null;
  }

  /**
   * Get wire start component pin ID (legacy)
   */
  getWireStartComponentPinId(): string | null {
    const start = this.state.startEndpoint;
    if (!start) return null;
    if (start.type === 'component') {
      return start.pinId;
    }
    return null;
  }

  /**
   * Get wire start sub-harness ID (legacy)
   */
  getWireStartSubHarnessId(): string | null {
    const start = this.state.startEndpoint;
    if (!start) return null;
    if (start.type === 'subHarness') {
      return start.subHarnessId;
    }
    return null;
  }

  /**
   * Get wire start sub-harness connector ID (legacy)
   */
  getWireStartSubHarnessConnectorId(): string | null {
    const start = this.state.startEndpoint;
    if (!start) return null;
    if (start.type === 'subHarness') {
      return start.connectorId;
    }
    return null;
  }

  /**
   * Get hovered connector ID (legacy)
   */
  getHoveredConnectorId(): string | null {
    const hovered = this.state.hoveredEndpoint;
    if (!hovered) return null;
    if (hovered.type === 'connector') {
      return hovered.connectorId;
    }
    return null;
  }

  /**
   * Get hovered pin ID (legacy)
   */
  getHoveredPinId(): string | null {
    const hovered = this.state.hoveredEndpoint;
    if (!hovered) return null;
    if (hovered.type === 'connector' || hovered.type === 'connectorMating' || hovered.type === 'subHarness') {
      return hovered.pinId;
    }
    return null;
  }

  /**
   * Get hovered mating connector ID (legacy)
   */
  getHoveredMatingConnectorId(): string | null {
    const hovered = this.state.hoveredEndpoint;
    if (!hovered) return null;
    if (hovered.type === 'connectorMating') {
      return hovered.connectorId;
    }
    return null;
  }

  /**
   * Get hovered mating pin ID (legacy)
   */
  getHoveredMatingPinId(): string | null {
    const hovered = this.state.hoveredEndpoint;
    if (!hovered) return null;
    if (hovered.type === 'connectorMating') {
      return hovered.pinId;
    }
    return null;
  }

  /**
   * Get hovered cable ID (legacy)
   */
  getHoveredCableId(): string | null {
    const hovered = this.state.hoveredEndpoint;
    if (!hovered) return null;
    if (hovered.type === 'cable') {
      return hovered.cableId;
    }
    return null;
  }

  /**
   * Get hovered cable wire ID (legacy)
   */
  getHoveredCableWireId(): string | null {
    const hovered = this.state.hoveredEndpoint;
    if (!hovered) return null;
    if (hovered.type === 'cable') {
      return hovered.wireId;
    }
    return null;
  }

  /**
   * Get hovered cable side (legacy)
   */
  getHoveredCableSide(): 'left' | 'right' | null {
    const hovered = this.state.hoveredEndpoint;
    if (!hovered) return null;
    if (hovered.type === 'cable') {
      return hovered.side;
    }
    return null;
  }

  /**
   * Get hovered component ID (legacy)
   */
  getHoveredComponentId(): string | null {
    const hovered = this.state.hoveredEndpoint;
    if (!hovered) return null;
    if (hovered.type === 'component') {
      return hovered.componentId;
    }
    return null;
  }

  /**
   * Get hovered component pin ID (legacy)
   */
  getHoveredComponentPinId(): string | null {
    const hovered = this.state.hoveredEndpoint;
    if (!hovered) return null;
    if (hovered.type === 'component') {
      return hovered.pinId;
    }
    return null;
  }

  /**
   * Get start endpoint position (for wire preview rendering)
   */
  getStartPosition(): Point | null {
    return this.state.startEndpoint?.position || null;
  }
}
