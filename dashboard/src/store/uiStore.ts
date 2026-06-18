import { create } from 'zustand';

interface Notification {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  createdAt: Date;
  read: boolean;
}

interface UIState {
  sidebarOpen: boolean;
  mobileSidebarOpen: boolean;
  notifications: Notification[];
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  addNotification: (n: Omit<Notification, 'id' | 'createdAt' | 'read'>) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  mobileSidebarOpen: false,
  notifications: [],
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleMobileSidebar: () => set((s) => ({ mobileSidebarOpen: !s.mobileSidebarOpen })),
  closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
  addNotification: (n) =>
    set((s) => ({
      notifications: [
        { ...n, id: crypto.randomUUID(), createdAt: new Date(), read: false },
        ...s.notifications,
      ].slice(0, 50),
    })),
  markAllRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
    })),
  clearNotifications: () => set({ notifications: [] }),
}));
