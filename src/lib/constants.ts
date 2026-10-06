import { BrandingConfig, PricingConfig, Kiosk, Printer } from './types';

export const DEFAULT_BRANDING: BrandingConfig = {
  organization: 'GITAM',
  product: 'SMARTPRINT',
  primary_tagline: 'SCAN. UPLOAD. PAY. PRINT.',
  secondary_tagline: 'Smart Campus Printing, Made Simple.',
  powered_by: 'Nikhil',
  support_number: '9006496970',
  primary_color: '#0d253f', // Postal-inspired Deep Blue
  secondary_color: '#1e40af', // Royal Blue
  accent_color: '#ef4444', // Subtle Red
  bg_color: '#ffffff',
  welcome_message: 'Welcome to GITAM SMARTPRINT. Scan the QR code to start printing quickly and securely from your phone.',
  instructions: '1. Scan Kiosk QR  2. Upload Document  3. Select Options  4. Pay via UPI  5. Collect Document',
  success_message: 'Your document has been printed successfully. Please collect your pages from the printer tray.',
  maintenance_message: 'GITAM SMARTPRINT is temporarily undergoing maintenance. For assistance, contact support.',
};

export const DEFAULT_PRICING: PricingConfig = {
  bw_price_per_page: 1.0,
  color_price_per_page: 5.0,
  service_charge: 0.0,
  min_order_amount: 1.0,
  max_pages: 100,
  max_copies: 10,
  max_file_size_mb: 20,
  updated_by: 'Nikhil (System Admin)',
  updated_at: new Date().toISOString(),
};

export const INITIAL_KIOSKS: Kiosk[] = [
  {
    id: 'GITAM-SPK-001',
    name: 'Central Library Kiosk 01',
    location: 'Knowledge Resource Centre (Ground Floor)',
    device_token_hash: 'gitam_spk_001_secure_device_secret_2026',
    status: 'ONLINE',
    ip_address: '192.168.1.105',
    mac_address: 'B8:27:EB:4D:2A:11',
    last_heartbeat: new Date().toISOString(),
    cpu_temp_celsius: 42.5,
    ram_usage_percent: 34.2,
    disk_usage_percent: 18.7,
    agent_version: '1.0.0',
    maintenance_mode: false,
  },
  {
    id: 'GITAM-SPK-002',
    name: 'ICT Bhavan Kiosk 02',
    location: 'Engineering Block - 2nd Floor Corridor',
    device_token_hash: 'gitam_spk_002_secure_device_secret_2026',
    status: 'ONLINE',
    ip_address: '192.168.1.106',
    mac_address: 'B8:27:EB:7F:3C:99',
    last_heartbeat: new Date().toISOString(),
    cpu_temp_celsius: 44.1,
    ram_usage_percent: 38.0,
    disk_usage_percent: 21.3,
    agent_version: '1.0.0',
    maintenance_mode: false,
  },
];

export const INITIAL_PRINTERS: Printer[] = [
  {
    id: 'printer-hp-001',
    kiosk_id: 'GITAM-SPK-001',
    printer_name: 'HP LaserJet Pro M404dn',
    model: 'HP LaserJet Series (USB 2.0)',
    cups_queue_name: 'HP_LaserJet_USB',
    connection_type: 'USB',
    status: 'READY',
    is_default: true,
    supports_color: true,
    supports_duplex: true,
    last_test_print: new Date().toISOString(),
  },
  {
    id: 'printer-hp-002',
    kiosk_id: 'GITAM-SPK-002',
    printer_name: 'HP LaserJet 1020 Plus',
    model: 'HP LaserJet 1020 (USB)',
    cups_queue_name: 'HP_LaserJet_USB',
    connection_type: 'USB',
    status: 'READY',
    is_default: true,
    supports_color: false,
    supports_duplex: false,
    last_test_print: new Date().toISOString(),
  },
];
