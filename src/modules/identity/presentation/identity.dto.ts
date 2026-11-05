import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { PaginationQuery } from '../../../shared/presentation/pagination.dto';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../domain/password-policy';
import type { UserStatus } from '../domain/user';

// ---------- Peticiones ----------

export class RegisterDto {
  @ApiProperty({ example: 'ana@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiProperty({ example: 'Ana' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName!: string;

  @ApiProperty({ example: 'Pérez' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastName!: string;

  @ApiPropertyOptional({ example: '+57 300 000 0000' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiProperty({ description: 'Acepta los términos y la política de tratamiento de datos' })
  @IsBoolean()
  acceptTerms!: boolean;
}

export class LoginDto {
  @ApiProperty({ example: 'ana@example.com' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class EmailDto {
  @ApiProperty({ example: 'ana@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class TokenDto {
  @ApiProperty({ description: 'Token recibido en el enlace del correo' })
  @IsString()
  @Length(20, 200)
  token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  password!: string;
}

const USER_STATUSES: UserStatus[] = ['ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED'];

export class ListUsersQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: 'Busca en correo, nombre y apellido' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: UserStatus;
}

export class ChangeStatusDto {
  @ApiProperty({ enum: ['suspend', 'reactivate'] })
  @IsIn(['suspend', 'reactivate'])
  action!: 'suspend' | 'reactivate';
}

export class AssignRolesDto {
  @ApiProperty({ example: ['customer'], type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  roles!: string[];
}

// ---------- Respuestas ----------

export class MeResponse {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ enum: USER_STATUSES }) status!: UserStatus;
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty({ type: [String] }) permissions!: string[];
}

export class AccessTokenResponse {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ description: 'Segundos hasta que vence el access token' }) expiresIn!: number;
}

export class LoginResponse extends AccessTokenResponse {
  @ApiProperty({ type: MeResponse }) user!: MeResponse;
}

export class RegisterResponse {
  @ApiProperty() userId!: string;
}

export class AdminUserResponse {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ enum: USER_STATUSES }) status!: UserStatus;
  @ApiProperty({ nullable: true, type: Date }) emailVerifiedAt!: Date | null;
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty() createdAt!: Date;
}

export class AdminUserPage {
  @ApiProperty({ type: [AdminUserResponse] }) items!: AdminUserResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class RoleResponse {
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty() userCount!: number;
}
