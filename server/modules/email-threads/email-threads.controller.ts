import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { IsString, IsOptional, IsIn } from 'class-validator';
import { JwtAuthGuard, type RequestWithUser } from '../auth/jwt-auth.guard';
import { EmailThreadsService } from './email-threads.service';
import type {
  EmailThread,
  CreateEmailThreadRequest,
  EmailThreadListResponse,
} from '@shared/api.interface';

class ListQueryDto {
  @IsString()
  companyId!: string;
}

class CreateEmailThreadDto implements CreateEmailThreadRequest {
  @IsString()
  companyId!: string;

  @IsString()
  projectId!: string;

  @IsString()
  threadDate!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  @IsIn(['inbound', 'outbound', 'note'])
  direction?: 'inbound' | 'outbound' | 'note';
}

// 用应用自己的 JwtAuthGuard（与其余业务接口一致）。平台 @NeedLogin() 依赖
// 平台会话 userContext，自建部署下永远 401；userId 改从 JWT payload 取。
@UseGuards(JwtAuthGuard)
@Controller('api/email-threads')
export class EmailThreadsController {
  constructor(private readonly emailThreadsService: EmailThreadsService) {}

  @Get()
  async findAll(
    @Query() query: ListQueryDto,
  ): Promise<EmailThreadListResponse> {
    return this.emailThreadsService.listByCompanyId(query.companyId);
  }

  @Post()
  async create(
    @Req() req: RequestWithUser,
    @Body() dto: CreateEmailThreadDto,
  ): Promise<EmailThread> {
    const { userId } = req.user;
    return this.emailThreadsService.create(dto, userId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    if (!id) {
      throw new BadRequestException('缺少 id');
    }
    await this.emailThreadsService.remove(id);
  }
}
