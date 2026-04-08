import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTrackedCnpjDto {
  @IsString()
  @IsNotEmpty()
  cnpj: string;

  @IsString()
  @IsOptional()
  name?: string;
}

export class UpdateTrackedCnpjDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
