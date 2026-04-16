import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTrackedCnpjDto {
  @IsString()
  @IsNotEmpty()
  cnpj: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  employerUnionName?: string;

  @IsString()
  @IsOptional()
  employerUnionCnpj?: string;

  @IsString()
  @IsOptional()
  laborUnionName?: string;

  @IsString()
  @IsOptional()
  laborUnionCnpj?: string;

  @IsString()
  @IsOptional()
  baseMonth?: string;
}

export class UpdateTrackedCnpjDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  cnpj?: string;

  @IsString()
  @IsOptional()
  employerUnionName?: string;

  @IsString()
  @IsOptional()
  employerUnionCnpj?: string;

  @IsString()
  @IsOptional()
  laborUnionName?: string;

  @IsString()
  @IsOptional()
  laborUnionCnpj?: string;

  @IsString()
  @IsOptional()
  baseMonth?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
