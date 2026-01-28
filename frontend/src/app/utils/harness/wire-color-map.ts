// Standard wire color definitions for automotive/aerospace wire harnesses
// Based on common industry color codes

export interface WireColor {
  code: string;
  name: string;
  hex: string;
  textColor: string; // For text visibility on the color
}

export const WIRE_COLORS: WireColor[] = [
  { code: 'BK', name: 'Black', hex: '#1a1a1a', textColor: '#ffffff' },
  { code: 'WH', name: 'White', hex: '#ffffff', textColor: '#000000' },
  { code: 'RD', name: 'Red', hex: '#cc0000', textColor: '#ffffff' },
  { code: 'GN', name: 'Green', hex: '#006600', textColor: '#ffffff' },
  { code: 'BU', name: 'Blue', hex: '#0000cc', textColor: '#ffffff' },
  { code: 'YE', name: 'Yellow', hex: '#ffcc00', textColor: '#000000' },
  { code: 'OR', name: 'Orange', hex: '#ff6600', textColor: '#000000' },
  { code: 'BR', name: 'Brown', hex: '#663300', textColor: '#ffffff' },
  { code: 'PK', name: 'Pink', hex: '#ff99cc', textColor: '#000000' },
  { code: 'VT', name: 'Violet', hex: '#9933ff', textColor: '#ffffff' },
  { code: 'GY', name: 'Gray', hex: '#808080', textColor: '#ffffff' },
  { code: 'TN', name: 'Tan', hex: '#d2b48c', textColor: '#000000' },
  { code: 'LB', name: 'Light Blue', hex: '#66b3ff', textColor: '#000000' },
  { code: 'LG', name: 'Light Green', hex: '#90ee90', textColor: '#000000' },
  { code: 'DG', name: 'Dark Green', hex: '#004d00', textColor: '#ffffff' },
  { code: 'DB', name: 'Dark Blue', hex: '#000066', textColor: '#ffffff' },
];

// Stripe/tracer colors (for wires with stripes)
export const STRIPE_COLORS: WireColor[] = [
  { code: 'BK', name: 'Black Stripe', hex: '#1a1a1a', textColor: '#ffffff' },
  { code: 'WH', name: 'White Stripe', hex: '#ffffff', textColor: '#000000' },
  { code: 'RD', name: 'Red Stripe', hex: '#cc0000', textColor: '#ffffff' },
  { code: 'GN', name: 'Green Stripe', hex: '#006600', textColor: '#ffffff' },
  { code: 'BU', name: 'Blue Stripe', hex: '#0000cc', textColor: '#ffffff' },
  { code: 'YE', name: 'Yellow Stripe', hex: '#ffcc00', textColor: '#000000' },
  { code: 'OR', name: 'Orange Stripe', hex: '#ff6600', textColor: '#000000' },
];

// Helper function to get wire color by code
export function getWireColor(code: string): WireColor | undefined {
  return WIRE_COLORS.find(c => c.code === code);
}

// Helper function to get hex color from code
export function getWireColorHex(code: string): string {
  const color = getWireColor(code);
  return color ? color.hex : '#808080'; // Default to gray
}

// Parse color code string (e.g., "RD/WH" for Red with White stripe)
export function parseColorCode(colorCode: string): { base: WireColor | undefined; stripe: WireColor | undefined } {
  const parts = colorCode.split('/');
  return {
    base: getWireColor(parts[0]),
    stripe: parts[1] ? getWireColor(parts[1]) : undefined
  };
}

// AWG wire gauges commonly used
export const AWG_GAUGES = [
  '30', '28', '26', '24', '22', '20', '18', '16', '14', '12', '10', '8', '6', '4', '2', '1', '0', '00', '000', '0000'
];

// Connector types
export const CONNECTOR_TYPES = [
  { value: 'male', label: 'Male Connector' },
  { value: 'female', label: 'Female Connector' },
  { value: 'terminal', label: 'Terminal Block' },
  { value: 'splice', label: 'Splice' },
];

// Common connector colors
export const CONNECTOR_COLORS: WireColor[] = [
  { code: 'BK', name: 'Black', hex: '#333333', textColor: '#ffffff' },
  { code: 'WH', name: 'White', hex: '#f0f0f0', textColor: '#000000' },
  { code: 'GY', name: 'Gray', hex: '#808080', textColor: '#ffffff' },
  { code: 'BU', name: 'Blue', hex: '#0066cc', textColor: '#ffffff' },
  { code: 'GN', name: 'Green', hex: '#339933', textColor: '#ffffff' },
  { code: 'RD', name: 'Red', hex: '#cc3333', textColor: '#ffffff' },
  { code: 'YE', name: 'Yellow', hex: '#ffcc00', textColor: '#000000' },
  { code: 'OR', name: 'Orange', hex: '#ff9933', textColor: '#000000' },
];
