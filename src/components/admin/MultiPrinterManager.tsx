'use client';

import React, { useState } from 'react';
import {
  Printer as PrinterIcon,
  Plus,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Settings,
  History,
  AlertCircle,
  Copy,
  Check,
  Power,
  Star,
  Trash2,
  X,
  Layers,
  Palette,
  ShieldAlert,
  Server,
  Usb,
  Wifi,
} from 'lucide-react';
import { Printer } from '@/lib/types';

interface MultiPrinterManagerProps {
  printers: any[];
  kiosks: any[];
  routings?: any[];
  onRefresh: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

export default function MultiPrinterManager({
  printers,
  kiosks,
  routings = [],
  onRefresh,
  showToast,
  getAuthHeaders,
}: MultiPrinterManagerProps) {
  // State
  const [selectedKioskId, setSelectedKioskId] = useState<string>('ALL');
  const [testingPrinterId, setTestingPrinterId] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modals state
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [editingPrinter, setEditingPrinter] = useState<any | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);

  // History & Errors Modals
  const [historyModalPrinter, setHistoryModalPrinter] = useState<any | null>(null);
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  const [errorsModalPrinter, setErrorsModalPrinter] = useState<any | null>(null);
  const [errorLogsList, setErrorLogsList] = useState<any[]>([]);
  const [loadingErrors, setLoadingErrors] = useState<boolean>(false);

  // New Printer Form State
  const [newPrinterForm, setNewPrinterForm] = useState({
    kiosk_id: kiosks[0]?.id || 'GITAM-SPK-001',
    printer_name: '',
    display_name: '',
    manufacturer: 'HP',
    model: '',
    cups_queue_name: '',
    connection_type: 'USB',
    supports_color: false,
    supports_duplex: false,
    enabled: true,
    priority: 1,
    is_default: false,
  });

  // Filter printers by selected kiosk
  const filteredPrinters = (printers || []).filter((p) => {
    if (selectedKioskId === 'ALL') return true;
    return p.kiosk_id === selectedKioskId;
  });

  // Copy helper
  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    showToast('Printer ID copied to clipboard');
  };

  // 1. Dispatch Test Print
  const handleTestPrint = async (printer: any) => {
    setTestingPrinterId(printer.id);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/test-print', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ printer_id: printer.id, kiosk_id: printer.kiosk_id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Test print dispatched to ${printer.cups_queue_name}! (Job: ${data.test_print_id})`);
        onRefresh();
      } else {
        showToast(data.error || 'Failed to dispatch test print', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Test print request error', 'error');
    } finally {
      setTestingPrinterId(null);
    }
  };

  // 2. Discover Printers on Kiosk
  const handleDiscoverPrinters = async () => {
    const targetKiosk = selectedKioskId === 'ALL' ? (kiosks[0]?.id || 'GITAM-SPK-001') : selectedKioskId;
    setIsDiscovering(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/printers/discover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ kiosk_id: targetKiosk }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.message || 'Printer hardware discovery scan completed!');
        onRefresh();
      } else {
        showToast(data.error || 'Discovery scan failed', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Discovery request error', 'error');
    } finally {
      setIsDiscovering(false);
    }
  };

  // 3. Toggle Enabled / Disabled
  const handleToggleEnabled = async (printer: any) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/printers', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ id: printer.id, enabled: !printer.enabled }),
      });
      if (res.ok) {
        showToast(`Printer ${printer.display_name || printer.printer_name} ${!printer.enabled ? 'enabled' : 'disabled'}`);
        onRefresh();
      } else {
        showToast('Failed to update printer state', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Request error', 'error');
    }
  };

  // 4. Set as Default Printer for Kiosk
  const handleSetDefault = async (printer: any) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/printers', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ id: printer.id, is_default: true }),
      });
      if (res.ok) {
        showToast(`${printer.display_name || printer.printer_name} set as default for ${printer.kiosk_id}`);
        onRefresh();
      } else {
        showToast('Failed to set default printer', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Request error', 'error');
    }
  };

  // 5. Delete Printer
  const handleDeletePrinter = async (printer: any) => {
    if (!confirm(`Are you sure you want to remove printer "${printer.display_name || printer.printer_name}"?`)) {
      return;
    }
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/admin/printers?id=${printer.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (res.ok) {
        showToast('Printer removed successfully');
        onRefresh();
      } else {
        showToast('Failed to delete printer', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Delete request error', 'error');
    }
  };

  // 6. Save Edit Printer Form
  const handleSaveEditPrinter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPrinter) return;

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/printers', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          id: editingPrinter.id,
          printer_name: editingPrinter.printer_name,
          display_name: editingPrinter.display_name,
          manufacturer: editingPrinter.manufacturer,
          model: editingPrinter.model,
          cups_queue_name: editingPrinter.cups_queue_name,
          connection_type: editingPrinter.connection_type,
          supports_color: editingPrinter.supports_color,
          supports_duplex: editingPrinter.supports_duplex,
          priority: Number(editingPrinter.priority) || 1,
          enabled: editingPrinter.enabled,
        }),
      });
      if (res.ok) {
        showToast('Printer configuration updated!');
        setIsEditModalOpen(false);
        setEditingPrinter(null);
        onRefresh();
      } else {
        showToast('Failed to update printer', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Save error', 'error');
    }
  };

  // 7. Create New Printer Form
  const handleCreatePrinter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPrinterForm.printer_name || !newPrinterForm.cups_queue_name) {
      showToast('Printer name and CUPS queue are required', 'error');
      return;
    }

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/printers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(newPrinterForm),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Printer ${newPrinterForm.printer_name} added successfully!`);
        setIsAddModalOpen(false);
        setNewPrinterForm({
          kiosk_id: kiosks[0]?.id || 'GITAM-SPK-001',
          printer_name: '',
          display_name: '',
          manufacturer: 'HP',
          model: '',
          cups_queue_name: '',
          connection_type: 'USB',
          supports_color: false,
          supports_duplex: false,
          enabled: true,
          priority: 1,
          is_default: false,
        });
        onRefresh();
      } else {
        showToast(data.error || 'Failed to create printer', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Creation error', 'error');
    }
  };

  // 8. Open History Modal
  const handleOpenHistory = async (printer: any) => {
    setHistoryModalPrinter(printer);
    setLoadingHistory(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/admin/printers/${printer.id}/history`, {
        headers: authHeaders,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setHistoryList(data.history || []);
      } else {
        setHistoryList([]);
      }
    } catch {
      setHistoryList([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  // 9. Open Errors Modal
  const handleOpenErrors = async (printer: any) => {
    setErrorsModalPrinter(printer);
    setLoadingErrors(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/admin/printers/${printer.id}/errors`, {
        headers: authHeaders,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setErrorLogsList(data.logs || []);
      } else {
        setErrorLogsList([]);
      }
    } catch {
      setErrorLogsList([]);
    } finally {
      setLoadingErrors(false);
    }
  };

  // Status Badge Helper
  const getStatusBadge = (status: string) => {
    const s = (status || 'UNKNOWN').toUpperCase();
    if (s === 'READY' || s === 'IDLE' || s === 'ONLINE') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          ONLINE / READY
        </span>
      );
    }
    if (s === 'PRINTING' || s === 'BUSY') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-spin"></span>
          PRINTING
        </span>
      );
    }
    if (s === 'PAPER_OUT') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
          <AlertTriangle className="w-3 h-3 text-amber-600" />
          PAPER OUT
        </span>
      );
    }
    if (s === 'TONER_EMPTY') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-orange-100 text-orange-800 border border-orange-200">
          <AlertCircle className="w-3 h-3 text-orange-600" />
          TONER EMPTY
        </span>
      );
    }
    if (s === 'STOPPED' || s === 'PAUSED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
          <Power className="w-3 h-3 text-purple-600" />
          STOPPED
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
        <AlertTriangle className="w-3 h-3 text-rose-600" />
        {s}
      </span>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
      {/* HEADER & ACTION TOOLBAR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-slate-900">Multi-Printer Management Platform</h3>
            <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-xs font-semibold border border-blue-200">
              Up to 5 Printers / Kiosk
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Independent hardware discovery, real-time CUPS status, error tracking, and routing management.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Kiosk Filter Selector */}
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <span>Kiosk:</span>
            <select
              value={selectedKioskId}
              onChange={(e) => setSelectedKioskId(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-xl bg-white text-slate-900 text-xs font-bold"
            >
              <option value="ALL">All Kiosks ({printers.length} total)</option>
              {kiosks.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} ({k.id})
                </option>
              ))}
            </select>
          </div>

          {/* Discover Hardware Button */}
          <button
            onClick={handleDiscoverPrinters}
            disabled={isDiscovering}
            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 disabled:opacity-50"
            title="Scan USB and Network for newly attached physical printers"
          >
            <Search className={`w-3.5 h-3.5 ${isDiscovering ? 'animate-spin' : ''}`} />
            <span>{isDiscovering ? 'Scanning Hardware...' : 'Discover Printers'}</span>
          </button>

          {/* Add Printer Manually */}
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Printer</span>
          </button>

          {/* Refresh All */}
          <button
            onClick={onRefresh}
            className="p-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl transition-colors"
            title="Refresh Status"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* PRINTERS GRID (UP TO 5 PRINTER CARDS) */}
      {filteredPrinters.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-2xl space-y-3">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
            <PrinterIcon className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-bold text-slate-800">No Printers Found</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            No physical or configured CUPS printers detected for the selected filter. Click &quot;Discover Printers&quot; to probe connected USB and IPP hardware.
          </p>
          <button
            onClick={handleDiscoverPrinters}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors"
          >
            Run Discovery Scan
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {filteredPrinters.map((printer, index) => {
            const hasError = printer.last_error || ['ERROR', 'PAPER_OUT', 'TONER_EMPTY', 'STOPPED', 'OFFLINE'].includes(printer.status);
            return (
              <div
                key={printer.id}
                className={`p-5 rounded-2xl border transition-all space-y-4 ${
                  !printer.enabled
                    ? 'border-slate-200 bg-slate-50/70 opacity-75'
                    : hasError
                    ? 'border-amber-300 bg-amber-50/20 shadow-xs'
                    : 'border-slate-200 bg-white hover:border-blue-200 shadow-xs'
                }`}
              >
                {/* CARD TOP ROW: ICON, NAME, STATUS */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold ${
                      printer.supports_color
                        ? 'bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-xs'
                        : 'bg-slate-900 text-white shadow-xs'
                    }`}>
                      <PrinterIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-900">
                          {printer.display_name || printer.printer_name}
                        </h4>
                        {printer.is_default && (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                            <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                            DEFAULT
                          </span>
                        )}
                        {!printer.enabled && (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-200 text-slate-700">
                            DISABLED
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                        <span>{printer.manufacturer || 'HP'}</span>
                        <span>•</span>
                        <span className="font-medium text-slate-700">{printer.model || 'Laser Series'}</span>
                        <span>•</span>
                        <span className="font-mono text-slate-600">{printer.cups_queue_name}</span>
                      </div>
                    </div>
                  </div>

                  {getStatusBadge(printer.status)}
                </div>

                {/* HARDWARE IDENTITY & CAPABILITY BADGES */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {/* Color vs Mono */}
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border flex items-center gap-1 ${
                    printer.supports_color
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      : 'bg-slate-100 text-slate-700 border-slate-200'
                  }`}>
                    <Palette className="w-3 h-3" />
                    {printer.supports_color ? 'Color Printing' : 'Monochrome (B&W)'}
                  </span>

                  {/* Duplex vs Simplex */}
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border flex items-center gap-1 ${
                    printer.supports_duplex
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}>
                    <Layers className="w-3 h-3" />
                    {printer.supports_duplex ? '2-Sided (Duplex)' : '1-Sided (Simplex)'}
                  </span>

                  {/* Connection Type */}
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1">
                    {printer.connection_type === 'NETWORK' || printer.connection_type === 'IPP' ? (
                      <Wifi className="w-3 h-3 text-blue-600" />
                    ) : (
                      <Usb className="w-3 h-3 text-slate-700" />
                    )}
                    {printer.connection_type || 'USB'}
                  </span>

                  {/* Priority */}
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                    Priority #{printer.priority || index + 1}
                  </span>

                  {/* Assigned Kiosk */}
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                    <Server className="w-3 h-3" />
                    {printer.kiosk_id}
                  </span>
                </div>

                {/* CURRENT ERROR ALERT (IF PRESENT) */}
                {hasError && printer.last_error && (
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold">Hardware Alert:</strong> {printer.last_error}
                    </div>
                  </div>
                )}

                {/* TELEMETRY & ID DETAILS */}
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 pt-1 border-t border-slate-100">
                  <div className="flex items-center gap-1 truncate">
                    <span className="text-slate-400">ID:</span>
                    <span className="font-mono text-slate-700 truncate">{printer.id}</span>
                    <button
                      onClick={() => handleCopyId(printer.id)}
                      className="text-slate-400 hover:text-slate-700 shrink-0"
                      title="Copy Printer ID"
                    >
                      {copiedId === printer.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400">Last Detected: </span>
                    <strong className="text-slate-800">
                      {printer.last_detected_at ? new Date(printer.last_detected_at).toLocaleTimeString() : 'Recent'}
                    </strong>
                  </div>
                  <div className="truncate">
                    <span className="text-slate-400">Device URI: </span>
                    <span className="font-mono text-[10px] text-slate-700 truncate" title={printer.device_uri || 'N/A'}>
                      {printer.device_uri || 'Local CUPS Port'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400">Last Print: </span>
                    <strong className="text-slate-800">
                      {printer.last_test_print || printer.last_successful_print
                        ? new Date(printer.last_test_print || printer.last_successful_print).toLocaleTimeString()
                        : 'None yet'}
                    </strong>
                  </div>
                </div>

                {/* ACTION BUTTONS ROW */}
                <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {/* Test Print Button */}
                    <button
                      onClick={() => handleTestPrint(printer)}
                      disabled={testingPrinterId === printer.id || !printer.enabled}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
                    >
                      {testingPrinterId === printer.id && <RefreshCw className="w-3 h-3 animate-spin text-blue-400" />}
                      <span>{testingPrinterId === printer.id ? 'Dispatching...' : 'Test Print'}</span>
                    </button>

                    {/* Configure / Edit Button */}
                    <button
                      onClick={() => {
                        setEditingPrinter(printer);
                        setIsEditModalOpen(true);
                      }}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      <span>Configure</span>
                    </button>

                    {/* Toggle Enabled */}
                    <button
                      onClick={() => handleToggleEnabled(printer)}
                      className={`p-1.5 rounded-xl border text-xs font-semibold transition-colors ${
                        printer.enabled
                          ? 'border-slate-200 hover:bg-slate-100 text-slate-600'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      }`}
                      title={printer.enabled ? 'Disable Printer' : 'Enable Printer'}
                    >
                      <Power className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* View Print History */}
                    <button
                      onClick={() => handleOpenHistory(printer)}
                      className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
                      title="View Print History"
                    >
                      <History className="w-4 h-4" />
                    </button>

                    {/* View Error History */}
                    <button
                      onClick={() => handleOpenErrors(printer)}
                      className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-xl transition-colors"
                      title="View Error History"
                    >
                      <ShieldAlert className="w-4 h-4" />
                    </button>

                    {/* Set Default */}
                    {!printer.is_default && (
                      <button
                        onClick={() => handleSetDefault(printer)}
                        className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-colors"
                        title="Set as Default Printer"
                      >
                        <Star className="w-4 h-4" />
                      </button>
                    )}

                    {/* Delete */}
                    <button
                      onClick={() => handleDeletePrinter(printer)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                      title="Delete Printer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: CONFIGURE / EDIT PRINTER */}
      {isEditModalOpen && editingPrinter && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Settings className="w-4 h-4 text-blue-600" />
                Configure Printer Hardware
              </h4>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditPrinter} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Display Name</label>
                  <input
                    type="text"
                    value={editingPrinter.display_name || ''}
                    onChange={(e) => setEditingPrinter({ ...editingPrinter, display_name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold"
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">CUPS Queue Name</label>
                  <input
                    type="text"
                    value={editingPrinter.cups_queue_name || ''}
                    onChange={(e) => setEditingPrinter({ ...editingPrinter, cups_queue_name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Manufacturer</label>
                  <input
                    type="text"
                    value={editingPrinter.manufacturer || ''}
                    onChange={(e) => setEditingPrinter({ ...editingPrinter, manufacturer: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Model</label>
                  <input
                    type="text"
                    value={editingPrinter.model || ''}
                    onChange={(e) => setEditingPrinter({ ...editingPrinter, model: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Connection Type</label>
                  <select
                    value={editingPrinter.connection_type || 'USB'}
                    onChange={(e) => setEditingPrinter({ ...editingPrinter, connection_type: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold"
                  >
                    <option value="USB">USB</option>
                    <option value="IPP-USB">IPP-USB (Local Daemon)</option>
                    <option value="NETWORK">Network / IP</option>
                    <option value="IPP">IPP Everywhere</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Routing Priority (1-5)</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={editingPrinter.priority || 1}
                    onChange={(e) => setEditingPrinter({ ...editingPrinter, priority: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <label className="flex items-center gap-2 font-bold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPrinter.supports_color}
                    onChange={(e) => setEditingPrinter({ ...editingPrinter, supports_color: e.target.checked })}
                    className="rounded text-blue-600"
                  />
                  <span>Supports Color</span>
                </label>
                <label className="flex items-center gap-2 font-bold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPrinter.supports_duplex}
                    onChange={(e) => setEditingPrinter({ ...editingPrinter, supports_duplex: e.target.checked })}
                    className="rounded text-blue-600"
                  />
                  <span>Supports 2-Sided (Duplex)</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl font-bold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800"
                >
                  Save Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD PRINTER MANUALLY */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-600" />
                Add New Printer to Kiosk
              </h4>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePrinter} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Target Kiosk</label>
                <select
                  value={newPrinterForm.kiosk_id}
                  onChange={(e) => setNewPrinterForm({ ...newPrinterForm, kiosk_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold"
                >
                  {kiosks.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({k.id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Printer Name</label>
                  <input
                    type="text"
                    placeholder="e.g. HP Color LaserJet Pro"
                    value={newPrinterForm.printer_name}
                    onChange={(e) =>
                      setNewPrinterForm({
                        ...newPrinterForm,
                        printer_name: e.target.value,
                        display_name: newPrinterForm.display_name || e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold"
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">CUPS Queue Name</label>
                  <input
                    type="text"
                    placeholder="e.g. HP_Color_LaserJet"
                    value={newPrinterForm.cups_queue_name}
                    onChange={(e) => setNewPrinterForm({ ...newPrinterForm, cups_queue_name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Manufacturer</label>
                  <input
                    type="text"
                    placeholder="HP, Epson, Brother..."
                    value={newPrinterForm.manufacturer}
                    onChange={(e) => setNewPrinterForm({ ...newPrinterForm, manufacturer: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Connection Type</label>
                  <select
                    value={newPrinterForm.connection_type}
                    onChange={(e) => setNewPrinterForm({ ...newPrinterForm, connection_type: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold"
                  >
                    <option value="USB">USB</option>
                    <option value="IPP-USB">IPP-USB (Local Daemon)</option>
                    <option value="NETWORK">Network / IP</option>
                    <option value="IPP">IPP Everywhere</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <label className="flex items-center gap-2 font-bold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newPrinterForm.supports_color}
                    onChange={(e) => setNewPrinterForm({ ...newPrinterForm, supports_color: e.target.checked })}
                    className="rounded text-blue-600"
                  />
                  <span>Supports Color</span>
                </label>
                <label className="flex items-center gap-2 font-bold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newPrinterForm.supports_duplex}
                    onChange={(e) => setNewPrinterForm({ ...newPrinterForm, supports_duplex: e.target.checked })}
                    className="rounded text-blue-600"
                  />
                  <span>Supports 2-Sided (Duplex)</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl font-bold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700"
                >
                  Add Printer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: PRINT HISTORY MODAL */}
      {historyModalPrinter && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <History className="w-4 h-4 text-blue-600" />
                  Print History
                </h4>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  {historyModalPrinter.display_name} ({historyModalPrinter.cups_queue_name})
                </p>
              </div>
              <button
                onClick={() => setHistoryModalPrinter(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-2">
              {loadingHistory ? (
                <div className="py-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                  Loading print history...
                </div>
              ) : historyList.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  No print jobs have been processed on this printer queue yet.
                </div>
              ) : (
                historyList.map((job) => (
                  <div key={job.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 text-xs flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-slate-900">{job.id}</span>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {job.pages_total} page(s) • {job.copies} copy • {job.is_color ? 'Color' : 'B&W'} • {new Date(job.created_at).toLocaleString()}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                      {job.status}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 text-right">
              <button
                onClick={() => setHistoryModalPrinter(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: ERROR HISTORY MODAL */}
      {errorsModalPrinter && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  Hardware Error & Alert Logs
                </h4>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  {errorsModalPrinter.display_name} ({errorsModalPrinter.cups_queue_name})
                </p>
              </div>
              <button
                onClick={() => setErrorsModalPrinter(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-2">
              {loadingErrors ? (
                <div className="py-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-600" />
                  Loading error logs...
                </div>
              ) : errorLogsList.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  Zero hardware errors logged! This printer queue has been functioning normally.
                </div>
              ) : (
                errorLogsList.map((log) => (
                  <div key={log.id} className="p-3 rounded-xl border border-amber-200 bg-amber-50/50 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-900 uppercase">{log.error_state}</span>
                      <span className="text-[10px] text-slate-400">{new Date(log.occurred_at).toLocaleString()}</span>
                    </div>
                    <p className="text-slate-700 text-[11px] font-mono">{log.error_message || 'Hardware error reported by CUPS'}</p>
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 text-right">
              <button
                onClick={() => setErrorsModalPrinter(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
