import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { IsString, IsOptional, IsIn } from 'class-validator';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
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

@Controller('api/email-threads')
export class EmailThreadsController {
  constructor(private readonly emailThreadsService: EmailThreadsService) {}

  @NeedLogin()
  @Get()
  async findAll(
    @Query() query: ListQueryDto,
  ): Promise<EmailThreadListResponse> {
    return this.emailThreadsService.listByCompanyId(query.companyId);
  }

  @NeedLogin()
  @Post()
  async create(
    @Req() req: { userContext: { userId: string } },
    @Body() dto: CreateEmailThreadDto,
  ): Promise<EmailThread> {
    const { userId } = req.userContext;
    return this.emailThreadsService.create(dto, userId);
  }

  @NeedLogin()
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    if (!id) {
      throw new BadRequestException('缺少 id');
    }
    await this.emailThreadsService.remove(id);
  }
}
