'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  requestPasswordResetOtp,
  resetPassword,
} from '@/actions/auth.actions';

// Typed from the action's own state shape rather than a bare literal: the
// literal narrows to `{ success, message }` and `devCode` stops existing.
const initialState: { success: boolean; message: string; devCode?: string } = {
  success: false,
  message: '',
};

/**
 * Two steps in one component: request the code, then enter it.
 *
 * The email typed in step one is carried into step two as a hidden field rather
 * than a userId, because the request action deliberately does not tell the
 * client whether an account exists — handing back an id would undo that.
 * Sending back the address the visitor just typed leaks nothing they did not
 * already know.
 *
 * The step is DERIVED from the action's state rather than stored. Keeping it in
 * a `useState` and advancing it from an effect trips
 * `react-hooks/set-state-in-effect` — and rightly so, since the value is
 * already computable. `dismissed` is the only real state here: it records that
 * the visitor asked to go back and edit the address, which the action state
 * cannot express.
 */
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
      // The reset deliberately issues no session: the auth cookie is a
      // stateless JWT with no server-side table, so there is nothing to revoke.
      router.push('/login?reset=1');
    } else if (resetState.message) {
      toast.error(resetState.message);
    }
  }, [resetState, router]);

  return (
    <div className='min-h-screen flex items-center justify-center bg-blue-50 px-4'>
      <div className='w-full max-w-md bg-white shadow-md rounded-lg p-8 border border-gray-200'>
        <h1 className='text-3xl font-bold mb-2 text-center text-blue-600'>
          {step === 'request' ? 'Forgot password' : 'Choose a new password'}
        </h1>
        <p className='text-sm text-gray-500 text-center mb-6'>
          {step === 'request'
            ? linkedFromEmail
              ? 'Enter the 6-digit code we emailed you.'
              : 'We will email you a 6-digit code to confirm it is you.'
            : `Enter the code we sent to ${email || 'your address'}.`}
        </p>

        {step === 'request' ? (
          <form
            action={requestAction}
            className='space-y-4 text-gray-700'
            // Clearing `dismissed` here rather than in an effect: a fresh
            // request must be able to advance the step again after the visitor
            // backed out of it.
            onSubmit={() => setDismissed(false)}
          >
            <input
              className='w-full border border-gray-200 p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-400'
              type='email'
              name='email'
              placeholder='Your Email'
              autoComplete='email'
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              className='w-full bg-blue-600 text-white p-3 rounded hover:bg-blue-700 transition disabled:opacity-50'
              type='submit'
              disabled={requestPending}
            >
              {requestPending ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form action={resetAction} className='space-y-4 text-gray-700'>
            <input type='hidden' name='email' value={email} />

            {requestState.devCode && (
              <div className='border border-dashed border-amber-400 bg-amber-50 text-amber-900 rounded p-3 text-sm'>
                <p className='font-semibold'>Dev only — code not emailed</p>
                <p className='font-mono text-lg tracking-widest'>
                  {requestState.devCode}
                </p>
              </div>
            )}

            <input
              className='w-full border border-gray-200 p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 text-center tracking-widest'
              type='text'
              name='code'
              placeholder='000000'
              inputMode='numeric'
              autoComplete='one-time-code'
              maxLength={6}
              required
            />
            <input
              className='w-full border border-gray-200 p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-400'
              type='password'
              name='password'
              placeholder='New password'
              autoComplete='new-password'
              required
            />
            <input
              className='w-full border border-gray-200 p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-400'
              type='password'
              name='confirmPassword'
              placeholder='Confirm new password'
              autoComplete='new-password'
              required
            />
            <button
              className='w-full bg-blue-600 text-white p-3 rounded hover:bg-blue-700 transition disabled:opacity-50'
              type='submit'
              disabled={resetPending}
            >
              {resetPending ? 'Resetting…' : 'Reset password'}
            </button>
            <button
              type='button'
              onClick={() => setDismissed(true)}
              className='w-full text-sm text-blue-600 hover:underline'
            >
              Use a different email
            </button>
          </form>
        )}

        <Link
          href='/login'
          className='block text-center text-sm text-blue-600 hover:underline mt-6'
        >
          Back to login
        </Link>
      </div>
    </div>
  );
};

export default ForgotPasswordForm;