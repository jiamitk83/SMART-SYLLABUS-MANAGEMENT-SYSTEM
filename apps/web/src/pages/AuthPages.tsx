import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { passwordSchema } from '@/lib/schemas';
import { useAuth, type AuthUser } from '@/store/auth';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-white p-4">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Smart Syllabus Management System</div>
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
        {children}
      </Card>
    </div>
  );
}

const loginSchema = z.object({ identifier: z.string().min(1, 'Username or email is required'), password: z.string().min(1, 'Password is required') });

export function LoginPage() {
  const setSession = useAuth((s) => s.setSession);
  const [error, setError] = useState('');
  const { register, handleSubmit, formState } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const onSubmit = handleSubmit(async (v) => {
    setError('');
    try {
      const r = await api.post<{ accessToken: string; user: AuthUser }>('/api/auth/login', v);
      setSession(r.data.user, r.data.accessToken);
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  return (
    <Shell title="Sign in">
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Username or email" error={formState.errors.identifier?.message}>
          <Input autoComplete="username" {...register('identifier')} />
        </Field>
        <Field label="Password" error={formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register('password')} />
        </Field>
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>{formState.isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
        <div className="text-center text-sm"><Link className="text-brand-700 hover:underline" to="/forgot-password">Forgot password?</Link></div>
      </form>
    </Shell>
  );
}

export function ForgotPasswordPage() {
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const { register, handleSubmit, formState } = useForm<{ identifier: string }>({ resolver: zodResolver(z.object({ identifier: z.string().min(1, 'Required') })) });
  const onSubmit = handleSubmit(async (v) => {
    setError('');
    try {
      const r = await api.post<{ message: string }>('/api/auth/forgot-password', v);
      setDone(r.data.message);
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  return (
    <Shell title="Forgot password">
      {done ? (
        <Alert tone="green">{done} Ask your administrator for the reset token if email delivery is not configured.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Username or email" error={formState.errors.identifier?.message}><Input {...register('identifier')} /></Field>
          <Button type="submit" className="w-full" disabled={formState.isSubmitting}>Request reset</Button>
        </form>
      )}
      <div className="text-center text-sm"><Link className="text-brand-700 hover:underline" to="/login">Back to sign in</Link></div>
    </Shell>
  );
}

const resetSchema = z.object({ token: z.string().min(10, 'Token is required'), newPassword: passwordSchema });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { token: params.get('token') ?? '' } });
  const onSubmit = handleSubmit(async (v) => {
    setError('');
    try {
      await api.post('/api/auth/reset-password', v);
      navigate('/login');
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  return (
    <Shell title="Reset password">
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Reset token" error={formState.errors.token?.message}><Input {...register('token')} /></Field>
        <Field label="New password" error={formState.errors.newPassword?.message}><Input type="password" autoComplete="new-password" {...register('newPassword')} /></Field>
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>Update password</Button>
      </form>
    </Shell>
  );
}
