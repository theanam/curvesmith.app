import { toast as sonner } from 'sonner';

/** App-wide notifications (Sonner). Keep messages short. */
export const toast = Object.assign((msg: string) => sonner(msg), {
  success: (msg: string) => sonner.success(msg),
  error: (msg: string) => sonner.error(msg),
  info: (msg: string) => sonner.info(msg),
});
