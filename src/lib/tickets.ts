"use client";

/* ============================================================
   VOLTRIX front — Portefeuille local (tickets)
   Les tickets vivent côté client (localStorage) — l'API VOLTRIX
   est idempotente et ne stocke pas de compte utilisateur : le
   règlement passe par POST /api/bankroll/resolve, la vente par
   POST /api/cashout.
   ============================================================ */

import { useSyncExternalStore } from "react";
import type { Ticket } from "./voltrix-types";

const LS_KEY = "voltrix.tickets";
const WALLET_KEY = "voltrix.wallet";

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): Ticket[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Ticket[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(tickets: Ticket[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(tickets));
  listeners.forEach((l) => l());
}

export function addTicket(t: Ticket): void {
  const all = read();
  all.unshift(t);
  write(all);
}

export function updateTicket(id: string, patch: Partial<Ticket>): void {
  write(read().map((t) => (t.id === id ? { ...t, ...patch } : t)));
}

export function removeTicket(id: string): void {
  write(read().filter((t) => t.id !== id));
}

export function clearTickets(): void {
  write([]);
}

/* ---------- Portefeuille (solde simulé) ---------- */

export function readWallet(): number {
  if (typeof window === "undefined") return 500;
  const raw = localStorage.getItem(WALLET_KEY);
  const v = raw == null ? NaN : Number(raw);
  return Number.isFinite(v) ? v : 500;
}

export function writeWallet(v: number): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(WALLET_KEY, String(Math.round(v * 100) / 100));
  listeners.forEach((l) => l());
}

/* ---------- Hook React ---------- */
/* getSnapshot DOIT retourner une référence stable tant que localStorage
   n'a pas changé (sinon React boucle) : on ne re-parse que lorsque la
   chaîne brute change. */

let rawTickets: string | null = null;
let rawWallet: string | null = null;
let snapshot: { tickets: Ticket[]; wallet: number } = { tickets: [], wallet: 500 };
const serverSnapshot: { tickets: Ticket[]; wallet: number } = { tickets: [], wallet: 500 };

function getSnapshot(): { tickets: Ticket[]; wallet: number } {
  if (typeof window === "undefined") return serverSnapshot;
  const t = localStorage.getItem(LS_KEY) ?? "[]";
  const w = localStorage.getItem(WALLET_KEY) ?? "";
  if (t !== rawTickets || w !== rawWallet) {
    rawTickets = t;
    rawWallet = w;
    let parsed: Ticket[] = [];
    try {
      const arr = JSON.parse(t) as Ticket[];
      if (Array.isArray(arr)) parsed = arr;
    } catch {
      parsed = [];
    }
    let wallet = 500;
    if (w !== "") {
      const n = Number(w);
      if (Number.isFinite(n)) wallet = n;
    }
    snapshot = { tickets: parsed, wallet };
  }
  return snapshot;
}

export function useTickets(): { tickets: Ticket[]; wallet: number } {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSnapshot,
    () => serverSnapshot,
  );
}
