'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  requestPasswordResetOtp,
  resetPassword,
} from '@/actions/auth.actions';

const initialState: { success: boolean; message: string; devCode?: string } = {
  success: false,
  message: '',
};

const ForgotPasswordForm = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkedFromEmail = searchParams.get('step') === 'code';

  const [email, setEmail] = useState('');
  const [dismissed, setDismissed] = useState(false);

  const [requestState, requestAction, requestPending] = useActionState(
    requestPasswordResetOtp,
    initialState,
  );
  const [resetState, resetAction, resetPending] = useActionState(
    resetPassword,
    initialState,
  );

  const step = requestState.success && !dismissed ? 'code' : 'request';

  useEffect(() => {
    if (requestState.success) {
      toast.success(requestState.message);
    } else if (requestState.message) {
      toast.error(requestState.message);
    }
  }, [requestState]);

  useEffect(() => {
    if (resetState.success) {
      toast.success(resetState.message);
      router.push('/login?reset=1');
    } else if (resetState.message) {
      toast.error(resetState.message);
    }
  }, [resetState, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white shadow-sm">
            Q
          </div>
          <h1 className="text-headline-md text-slate-900">
            {step === 'request' ? 'Forgot password' : 'Choose a new password'}
          </h1>
          <p className="mt-1 text-body-md text-slate-500">
            {step === 'request'
              ? linkedFromEmail
                ? 'Enter the 6-digit code we emailed you.'
                : 'We will email you a 6-digit code to confirm it is you.'
              : `Enter the code we sent to ${email || 'your address'}.`}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-card">
          {step === 'request' ? (
            <form
              action={requestAction}
              className="space-y-4"
              onSubmit={() => setDismissed(false)}
            >
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Email
                </label>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  type="email"
                  name="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                type="submit"
                disabled={requestPending}
              >
                {requestPending && (
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                )}
                {requestPending ? 'Sending…' : 'Send code'}
              </button>
            </form>
          ) : (
            <form action={resetAction} className="space-y-4">
              <input type="hidden" name="email" value={email} />

              {requestState.devCode && (
                <div className="rounded-lg border border-dashed border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">Dev only — code not emailed</p>
                  <p className="mt-1 font-mono text-lg tracking-widest">
                    {requestState.devCode}
                  </p>
                </div>
              )}

              {resetState.message && !resetState.success && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {resetState.message}
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  6-digit code
                </label>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-center tracking-widest text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  type="text"
                  name="code"
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  New password
                </label>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  type="password"
                  name="password"
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Confirm password
                </label>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  type="password"
                  name="confirmPassword"
                  placeholder="Repeat password"
                  autoComplete="new-password"
                  required
                />
              </div>
              <button
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                type="submit"
                disabled={resetPending}
              >
                {resetPending && (
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                )}
                {resetPending ? 'Resetting…' : 'Reset password'}
              </button>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="w-full text-sm font-medium text-indigo-600 transition hover:text-indigo-700"
              >
                Use a different email
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          <Link
            href="/login"
            className="font-medium text-indigo-600 transition hover:text-indigo-700"
          >
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
};

export default ForgotPasswordForm;