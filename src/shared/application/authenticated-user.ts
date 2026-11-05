/** Usuario autenticado con sus permisos efectivos. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: 'ACTIVE' | 'PENDING_VERIFICATION' | 'SUSPENDED';
  roles: string[];
  permissions: string[];
}
