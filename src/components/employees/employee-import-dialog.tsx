"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, Upload, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Bulk employee import.
 *
 * The flow is deliberately two-step: choosing a file runs a DRY RUN on the
 * server and shows exactly what would happen, and only a second, explicit
 * click writes anything. Creating fifty people is not something to discover
 * after the fact.
 */

const TEMPLATE_HEADER = "First name,Last name,Email,Designation,Department,Office,Joined at";
const TEMPLATE_ROW = "Asha,Rao,asha.rao@example.com,Software Engineer,Engineering,Guntur HQ,2026-01-15";

interface RowOutcome {
  line: number;
  name: string;
  employeeCode?: string;
  status: "created" | "skipped" | "invalid";
  message?: string;
}

interface ImportResponse {
  ok: boolean;
  error?: string;
  committed?: boolean;
  summary?: {
    rows: number;
    created: number;
    invalid: number;
    skipped: number;
    truncated: boolean;
  };
  parseErrors?: Array<{ line: number; message: string }>;
  outcomes?: RowOutcome[];
}

export function EmployeeImportDialog() {
  const router = useRouter();

  const [open, setOpen] = React.useState(false);
  const [csv, setCsv] = React.useState<string | null>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ImportResponse | null>(null);
  const [busy, setBusy] = React.useState(false);

  const reset = () => {
    setCsv(null);
    setFileName(null);
    setResult(null);
    setBusy(false);
  };

  async function send(text: string, commit: boolean) {
    setBusy(true);
    try {
      const response = await fetch("/api/employees/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text, commit }),
      });
      const payload = (await response.json()) as ImportResponse;
      setResult(payload);

      if (commit && payload.summary && payload.summary.created > 0) {
        // The directory is server-rendered, so it needs re-fetching to show
        // the people just created.
        router.refresh();
      }
    } catch {
      setResult({ ok: false, error: "The import could not be sent. Check your connection." });
    } finally {
      setBusy(false);
    }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    await send(text, false);
  }

  function downloadTemplate() {
    // A BOM so Excel reads the file as UTF-8 rather than the system codepage.
    const blob = new Blob([`﻿${TEMPLATE_HEADER}\n${TEMPLATE_ROW}\n`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "employee-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const summary = result?.summary;
  const canCommit = Boolean(csv) && !result?.committed && (summary?.created ?? 0) > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Upload aria-hidden />
          Import
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import employees</DialogTitle>
          <DialogDescription>
            Upload a CSV. Nothing is saved until you confirm — you will see exactly what would
            happen first.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={cn(
                "inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line",
                "bg-surface-2 px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-3",
                busy && "pointer-events-none opacity-60",
              )}
            >
              <Upload className="size-4" aria-hidden />
              {fileName ?? "Choose a CSV file"}
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} />
            </label>

            <Button variant="ghost" size="sm" onClick={downloadTemplate} type="button">
              <Download aria-hidden />
              Template
            </Button>
          </div>

          <p className="text-xs text-ink-muted">
            Required columns: First name, Last name, Email, Designation. Optional: Department,
            Office, Joined at, Phone, Employee code. Departments and offices are matched by name.
          </p>

          {result?.error ? (
            <p
              role="alert"
              className="rounded-lg border border-critical/40 bg-critical-soft px-3 py-2 text-sm text-ink"
            >
              {result.error}
            </p>
          ) : null}

          {summary ? (
            <div className="flex flex-col gap-3" aria-live="polite">
              <div className="flex flex-wrap gap-3 text-sm">
                <Stat
                  icon={<CheckCircle2 className="size-4" aria-hidden />}
                  label={result?.committed ? "Created" : "Ready to create"}
                  value={summary.created}
                />
                <Stat
                  icon={<XCircle className="size-4" aria-hidden />}
                  label="Invalid"
                  value={summary.invalid}
                />
                <Stat
                  icon={<AlertTriangle className="size-4" aria-hidden />}
                  label="Skipped"
                  value={summary.skipped}
                />
              </div>

              {summary.truncated ? (
                <p className="text-xs text-warning">
                  Only the first rows were read — the file exceeds the import limit.
                </p>
              ) : null}

              {(result?.outcomes?.length ?? 0) > 0 ? (
                <div className="max-h-56 overflow-y-auto rounded-lg border border-line">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-surface-2 text-xs uppercase text-ink-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">Line</th>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result!.outcomes!.map((outcome) => (
                        <tr key={outcome.line} className="border-t border-line">
                          <td className="px-3 py-1.5 tabular-nums text-ink-muted">{outcome.line}</td>
                          <td className="px-3 py-1.5 text-ink">{outcome.name}</td>
                          <td
                            className={cn(
                              "px-3 py-1.5",
                              outcome.status === "created" ? "text-success" : "text-critical",
                            )}
                          >
                            {outcome.message ?? outcome.employeeCode ?? outcome.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} type="button">
            {result?.committed ? "Done" : "Cancel"}
          </Button>
          <Button
            onClick={() => csv && send(csv, true)}
            disabled={!canCommit || busy}
            type="button"
          >
            {busy
              ? "Working…"
              : summary
                ? `Import ${summary.created} employee${summary.created === 1 ? "" : "s"}`
                : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5">
      {icon}
      <span className="text-ink-muted">{label}</span>
      <strong className="tabular-nums text-ink">{value}</strong>
    </span>
  );
}
