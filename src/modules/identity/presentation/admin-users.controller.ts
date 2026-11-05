import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  type AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../../../shared/presentation/auth.decorators';
import { requestContextOf } from '../../../shared/presentation/request-context';
import {
  AssignUserRoles,
  ChangeUserStatus,
  GetUser,
  ListRoles,
  ListUsers,
} from '../application/user-administration.use-cases';
import { PERMISSIONS } from '../domain/permissions';
import type { User } from '../domain/user';
import {
  AdminUserPage,
  AdminUserResponse,
  AssignRolesDto,
  ChangeStatusDto,
  ListUsersQuery,
  RoleResponse,
} from './identity.dto';

/** Nunca se expone el hash de la contraseña. */
function toResponse(user: User): AdminUserResponse {
  const s = user.toSnapshot();
  return {
    id: s.id,
    email: s.email.value,
    firstName: s.firstName,
    lastName: s.lastName,
    phone: s.phone,
    status: s.status,
    emailVerifiedAt: s.emailVerifiedAt,
    roles: s.roles,
    createdAt: s.createdAt,
  };
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly listUsers: ListUsers,
    private readonly getUser: GetUser,
    private readonly changeStatus: ChangeUserStatus,
    private readonly assignRoles: AssignUserRoles,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Lista usuarios con búsqueda y filtro por estado' })
  @ApiOkResponse({ type: AdminUserPage })
  async list(@Query() query: ListUsersQuery): Promise<AdminUserPage> {
    const page = await this.listUsers.execute(query);
    return { ...page, items: page.items.map(toResponse) };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOkResponse({ type: AdminUserResponse })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserResponse> {
    return toResponse(await this.getUser.execute(id));
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Suspende (y cierra sus sesiones) o reactiva una cuenta' })
  @ApiOkResponse({ type: AdminUserResponse })
  async updateStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeStatusDto,
    @Req() request: Request,
  ): Promise<AdminUserResponse> {
    return toResponse(
      await this.changeStatus.execute(actor.id, id, body.action, requestContextOf(request)),
    );
  }

  @Put(':id/roles')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Reemplaza los roles del usuario' })
  @ApiOkResponse({ type: AdminUserResponse })
  async replaceRoles(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignRolesDto,
    @Req() request: Request,
  ): Promise<AdminUserResponse> {
    return toResponse(
      await this.assignRoles.execute(actor.id, id, body.roles, requestContextOf(request)),
    );
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/roles')
export class AdminRolesController {
  constructor(private readonly listRoles: ListRoles) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @ApiOkResponse({ type: [RoleResponse] })
  list(): Promise<RoleResponse[]> {
    return this.listRoles.execute();
  }
}
