import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';

interface FileUpload {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
import {
  IsString,
  IsOptional,
  IsIn,
  IsArray,
  Max,
  Min,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RestaurantsService } from './restaurants.service';
import type {
  Company,
  CompanyListResponse,
  CompanyStatsResponse,
  ImportResult,
  UpdateEmailRequest,
  DuplicateCheckResponse,
  BatchDeleteRequest,
} from '@shared/api.interface';

class ListQueryDto {
  @IsString()
  projectId!: string;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @IsIn([
    'pending',
    'analyzing',
    'analyzed',
    'generating',
    'generated',
    'no_email',
    'failed',
  ])
  status?:
    | 'pending'
    | 'analyzing'
    | 'analyzed'
    | 'generating'
    | 'generated'
    | 'no_email'
    | 'failed';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  noEmail?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isStarred?: boolean;

  @IsOptional()
  @IsString()
  @IsIn([
    'all',
    'starred',
    'analyzed',
    'pending',
    'generated',
    'no_email',
    'failed',
  ])
  filterKey?:
    | 'all'
    | 'starred'
    | 'analyzed'
    | 'pending'
    | 'generated'
    | 'no_email'
    | 'failed';
}

class StatsQueryDto {
  @IsString()
  projectId!: string;
}

class DuplicatesQueryDto {
  @IsString()
  projectId!: string;
}

class BatchDeleteQueryDto {
  @IsString()
  projectId!: string;
}

class BatchDeleteBodyDto implements BatchDeleteRequest {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

class UpdateEmailDto implements UpdateEmailRequest {
  @IsString()
  subject!: string;

  @IsString()
  body!: string;
}

class StarBodyDto {
  @IsBoolean()
  isStarred!: boolean;
}

class ContactStatusBodyDto {
  @IsString()
  @IsIn(['whatsapp', 'viber', 'email'])
  type!: 'whatsapp' | 'viber' | 'email';

  @IsBoolean()
  contacted!: boolean;
}

class NormalizePhonesBodyDto {
  @IsString()
  projectId!: string;
}

class ImportByBase64Dto {
  @IsString()
  projectId!: string;

  @IsString()
  @IsIn(['append', 'overwrite'])
  mode!: 'append' | 'overwrite';

  @IsString()
  fileName!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsString()
  contentBase64!: string;
}

@Controller('api/restaurants')
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @Get('stats')
  async getStats(
    @Query() query: StatsQueryDto,
  ): Promise<CompanyStatsResponse> {
    return this.restaurantsService.getStats(query.projectId);
  }

  @Get('duplicates')
  async findDuplicates(
    @Query() query: DuplicatesQueryDto,
  ): Promise<DuplicateCheckResponse> {
    const groups = await this.restaurantsService.findDuplicates(query.projectId);
    const totalDuplicates = groups.reduce(
      (sum: number, g) => sum + g.companies.length,
      0,
    );
    return { groups, totalDuplicates };
  }

  @Get()
  async findAll(
    @Query() query: ListQueryDto,
  ): Promise<CompanyListResponse> {
    return this.restaurantsService.findAll({
      projectId: query.projectId,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      search: query.search,
      noEmail: query.noEmail,
      isStarred: query.isStarred,
      filterKey: query.filterKey,
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Company> {
    return this.restaurantsService.findOne(id);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @UploadedFile() file: FileUpload,
    @Body('mode') mode: string,
    @Body('projectId') projectId: string,
  ): Promise<ImportResult> {
    if (!file) {
      throw new BadRequestException('未上传文件，请选择 Excel 文件后重试');
    }
    if (!projectId) {
      throw new BadRequestException('缺少项目 ID');
    }
    const importMode = mode === 'overwrite' ? 'overwrite' : 'append';
    return this.restaurantsService.importFromExcel(
      file.buffer,
      importMode,
      projectId,
      file.originalname || 'import.xlsx',
    );
  }

  @Post('import-base64')
  async importByBase64(
    @Body() dto: ImportByBase64Dto,
  ): Promise<ImportResult> {
    if (!dto.projectId) {
      throw new BadRequestException('缺少项目 ID');
    }
    if (!dto.contentBase64) {
      throw new BadRequestException('缺少文件内容');
    }
    const base64Clean = dto.contentBase64.includes(',')
      ? dto.contentBase64.split(',')[1]
      : dto.contentBase64;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64Clean, 'base64');
    } catch (err) {
      throw new BadRequestException('文件内容格式错误，无法解析 base64');
    }
    if (buffer.length === 0) {
      throw new BadRequestException('文件内容为空');
    }
    if (buffer.length > 30 * 1024 * 1024) {
      throw new BadRequestException('文件大小超过 30MB 限制');
    }
    const importMode = dto.mode === 'overwrite' ? 'overwrite' : 'append';
    return this.restaurantsService.importFromExcel(
      buffer,
      importMode,
      dto.projectId,
      dto.fileName || 'import.xlsx',
    );
  }

  @Post('batch-delete')
  async batchDelete(
    @Query() query: BatchDeleteQueryDto,
    @Body() body: BatchDeleteBodyDto,
  ): Promise<{ deleted: number }> {
    const deleted = await this.restaurantsService.batchDelete(
      query.projectId,
      body.ids,
    );
    return { deleted };
  }

  @NeedLogin()
  @Patch(':id/star')
  async toggleStar(
    @Param('id') id: string,
    @Body() body: StarBodyDto,
  ): Promise<Company> {
    return this.restaurantsService.toggleStar(id, body.isStarred);
  }

  @NeedLogin()
  @Patch(':id/contact-status')
  async updateContactStatus(
    @Param('id') id: string,
    @Body() body: ContactStatusBodyDto,
  ): Promise<Company> {
    return this.restaurantsService.updateContactStatus(
      id,
      body.type,
      body.contacted,
    );
  }

  @NeedLogin()
  @Post('normalize-phones')
  async normalizePhones(
    @Body() body: NormalizePhonesBodyDto,
  ): Promise<{ processed: number }> {
    if (!body.projectId) {
      throw new BadRequestException('缺少 projectId');
    }
    return this.restaurantsService.normalizePhonesByProject(body.projectId);
  }

  @Patch(':id/email')
  async updateEmail(
    @Param('id') id: string,
    @Body() dto: UpdateEmailDto,
  ): Promise<Company> {
    return this.restaurantsService.updateEmail(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.restaurantsService.remove(id);
  }
}
