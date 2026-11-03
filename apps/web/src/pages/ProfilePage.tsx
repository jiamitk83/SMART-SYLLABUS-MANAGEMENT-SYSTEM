import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Alert, Button, Card, Field, Input, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { passwordSchema } from '@/lib/schemas';
import { ROLE_LABEL } from '@/lib/utils';
import { useAuth, type AuthUser } from '@/store/auth';

const schema = z.object({ currentPassword: z.string().min(1, 'Required'), newPassword: passwordSchema });

export function ProfilePage() {
  const { user, setSession } = useAuth();
  const navigate = useNavigate();
  const forced = (useLocation().state as { forced?: boolean } | null)?.forced || user?.mustChangePassword;
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const { register, handleSubmit, reset, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const onSubmit = handleSubmit(async (v) => {
    setError('');
    setMsg('');
    try {
      const r = await api.post<{ accessToken: string; user: AuthUser }>('/auth/change-password', v);
      setSession(r.data.user, r.data.accessToken);
      reset();
      setMsg('Password changed.');
      if (forced) navigate('/');
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="My profile" />
      {forced && <Alert tone="amber">You must change your password before continuing.</Alert>}
      <Card className="space-y-1 text-sm">
        <div><b>Name:</b> {user?.fullName}</div>
        <div><b>Username:</b> {user?.username}</div>
        <div><b>Email:</b> {user?.email}</div>
        <div><b>Role:</b> {user ? ROLE_LABEL[user.role] : ''}</div>
      </Card>
      <Card>
        <h2 className="mb-3 font-medium">Change password</h2>
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          {error && <Alert>{error}</Alert>}
          {msg && <Alert tone="green">{msg}</Alert>}
          <Field label="Current password" error={formState.errors.currentPassword?.message}><Input type="password" autoComplete="current-password" {...register('currentPassword')} /></Field>
          <Field label="New password" error={formState.errors.newPassword?.message}><Input type="password" autoComplete="new-password" {...register('newPassword')} /></Field>
          <Button type="submit" disabled={formState.isSubmitting}>Update password</Button>
        </form>
      </Card>
    </div>
  );
}
