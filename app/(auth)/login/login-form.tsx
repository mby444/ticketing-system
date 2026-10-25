'use client';

import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { loginUser } from '@/actions/auth.actions';

const LoginForm = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set by the reset flow on success. A query param rather than session state:
  // it survives the redirect and works without JS reading anything.
  const justReset = searchParams.get('reset') === '1';

  const initialState = {
    success: false,
    message: '',
  };

  const [state, formAction] = useActionState(loginUser, initialState);

  useEffect(() => {
    if (state.success) {
      toast.success('Login successful!');
      router.push('/tickets');
    } else if (state.message) {
      toast.error(state.message);
    }
  }, [state, router]);

  return (
    <div className='min-h-screen flex items-center justify-center bg-blue-50 px-4'>
      <div className='w-full max-w-md bg-white shadow-md rounded-lg p-8 border border-gray-200'>
        <h1 className='text-3xl font-bold mb-6 text-center text-blue-600'>
          Login
        </h1>

        {justReset && (
          <p className='mb-4 rounded border border-green-200 bg-green-50 text-green-800 text-sm p-3'>
            Your password has been reset. Sign in with your new password.
          </p>
        )}

        <form action={formAction} className='space-y-4 text-gray-700'>
          <input
            className='w-full border border-gray-200 p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-400'
            type='email'
            name='email'
            placeholder='Your Email'
            autoComplete='email'
            required
          />
          <input
            className='w-full border border-gray-200 p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-400'
            type='password'
            name='password'
            placeholder='Password'
            autoComplete='new-password'
            required
          />
          <button
            className='w-full bg-blue-600 text-white p-3 rounded hover:bg-blue-700 transition disabled:opacity-50'
            type='submit'
          >
            Login
          </button>

          <Link
            href='/forgot-password'
            className='block text-center text-sm text-blue-600 hover:underline'
          >
            Forgot your password?
          </Link>
        </form>
      </div>
    </div>
  );
};

export default LoginForm;
