<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RangeCalendar } from '@/components/ui/range-calendar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { campaignsService } from '@/services/api'
import { wsService } from '@/services/websocket'
import { toast } from 'vue-sonner'
import { PageHeader, DataTable, DeleteConfirmDialog, SearchInput, IconButton, ErrorState, type Column } from '@/components/shared'
import { getErrorMessage } from '@/lib/api-utils'
import {
  Plus,
  Pencil,
  Trash2,
  Megaphone,
  Play,
  Pause,
  Users,
  CheckCircle,
  Clock,
  AlertCircle,
  CalendarIcon,
  ImageIcon,
  FileText
} from 'lucide-vue-next'
import { formatDate } from '@/lib/utils'
import { useDebounceFn } from '@vueuse/core'

const { t } = useI18n()

interface Campaign {
  id: string
  name: string
  template_name: string
  template_id?: string
  whatsapp_account?: string
  header_media_id?: string
  header_media_filename?: string
  header_media_mime_type?: string
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed' | 'queued' | 'processing' | 'cancelled'
  total_recipients: number
  sent_count: number
  delivered_count: number
  read_count: number
  failed_count: number
  scheduled_at?: string
  started_at?: string
  completed_at?: string
  created_at: string
}

const campaigns = ref<Campaign[]>([])
const isLoading = ref(true)

const columns = computed<Column<Campaign>[]>(() => [
  { key: 'name', label: t('campaigns.campaign'), sortable: true },
  { key: 'status', label: t('campaigns.status'), sortable: true },
  { key: 'stats', label: t('campaigns.progress') },
  { key: 'created_at', label: t('campaigns.created'), sortable: true },
  { key: 'actions', label: t('common.actions'), align: 'right' },
])

const sortKey = ref('created_at')
const sortDirection = ref<'asc' | 'desc'>('desc')
const searchQuery = ref('')

// Pagination state
const currentPage = ref(1)
const totalItems = ref(0)
const pageSize = 20

function handlePageChange(page: number) {
  currentPage.value = page
  fetchCampaigns()
}

// Filter state
const filterStatus = ref<string>('all')
type TimeRangePreset = 'today' | '7days' | '30days' | 'this_month' | 'custom'
const selectedRange = ref<TimeRangePreset>('this_month')
const customDateRange = ref<any>({ start: undefined, end: undefined })
const isDatePickerOpen = ref(false)

const statusOptions = computed(() => [
  { value: 'all', label: t('campaigns.allStatuses') },
  { value: 'draft', label: t('campaigns.draft') },
  { value: 'queued', label: t('campaigns.queued') },
  { value: 'processing', label: t('campaigns.processing') },
  { value: 'completed', label: t('campaigns.completed') },
  { value: 'failed', label: t('campaigns.failed') },
  { value: 'cancelled', label: t('campaigns.cancelled') },
  { value: 'paused', label: t('campaigns.paused') },
])

// Format date as YYYY-MM-DD in local timezone
const formatDateLocal = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getDateRange = computed(() => {
  const now = new Date()
  let from: Date
  let to: Date = now

  switch (selectedRange.value) {
    case 'today':
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      break
    case '7days':
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      break
    case '30days':
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      break
    case 'this_month':
      from = new Date(now.getFullYear(), now.getMonth(), 1)
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      break
    case 'custom':
      if (customDateRange.value.start && customDateRange.value.end) {
        from = new Date(customDateRange.value.start.year, customDateRange.value.start.month - 1, customDateRange.value.start.day)
        to = new Date(customDateRange.value.end.year, customDateRange.value.end.month - 1, customDateRange.value.end.day)
      } else {
        from = new Date(now.getFullYear(), now.getMonth(), 1)
        to = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      }
      break
    default:
      from = new Date(now.getFullYear(), now.getMonth(), 1)
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }

  return {
    from: formatDateLocal(from),
    to: formatDateLocal(to)
  }
})

const formatDateRangeDisplay = computed(() => {
  if (selectedRange.value === 'custom' && customDateRange.value.start && customDateRange.value.end) {
    const start = customDateRange.value.start
    const end = customDateRange.value.end
    return `${start.month}/${start.day}/${start.year} - ${end.month}/${end.day}/${end.year}`
  }
  return ''
})

// AlertDialog state
const deleteDialogOpen = ref(false)
const campaignToDelete = ref<Campaign | null>(null)
const isDeletingCampaign = ref(false)

// Error state
const error = ref<string | null>(null)

// WebSocket subscription for real-time stats updates
let unsubscribeCampaignStats: (() => void) | null = null

onMounted(async () => {
  await fetchCampaigns()

  // Subscribe to campaign stats updates
  unsubscribeCampaignStats = wsService.onCampaignStatsUpdate((payload) => {
    const campaign = campaigns.value.find(c => c.id === payload.campaign_id)
    if (campaign) {
      campaign.sent_count = payload.sent_count
      campaign.delivered_count = payload.delivered_count
      campaign.read_count = payload.read_count
      campaign.failed_count = payload.failed_count
      if (payload.status) {
        campaign.status = payload.status
      }
    }
  })
})

onUnmounted(() => {
  if (unsubscribeCampaignStats) {
    unsubscribeCampaignStats()
  }
})

async function fetchCampaigns() {
  isLoading.value = true
  error.value = null
  try {
    const { from, to } = getDateRange.value
    const params: Record<string, string | number> = {
      from,
      to,
      page: currentPage.value,
      limit: pageSize
    }
    if (filterStatus.value && filterStatus.value !== 'all') {
      params.status = filterStatus.value
    }
    if (searchQuery.value) {
      params.search = searchQuery.value
    }
    const response = await campaignsService.list(params)
    // API returns: { status: "success", data: { campaigns: [...], total: N } }
    const data = response.data.data || response.data
    campaigns.value = data.campaigns || []
    totalItems.value = data.total ?? campaigns.value.length
  } catch (err: any) {
    console.error('Failed to fetch campaigns:', err)
    error.value = getErrorMessage(err, t('campaigns.fetchFailed'))
    campaigns.value = []
    totalItems.value = 0
  } finally {
    isLoading.value = false
  }
}

function applyCustomRange() {
  if (customDateRange.value.start && customDateRange.value.end) {
    isDatePickerOpen.value = false
    fetchCampaigns()
  }
}

// Debounced search
const debouncedSearch = useDebounceFn(() => {
  currentPage.value = 1
  fetchCampaigns()
}, 300)

watch(searchQuery, () => debouncedSearch())

// Watch for filter changes
watch([filterStatus, selectedRange], () => {
  currentPage.value = 1
  if (selectedRange.value !== 'custom') {
    fetchCampaigns()
  }
})

function openDeleteDialog(campaign: Campaign) {
  campaignToDelete.value = campaign
  deleteDialogOpen.value = true
}

async function confirmDeleteCampaign() {
  if (!campaignToDelete.value) return

  isDeletingCampaign.value = true
  try {
    await campaignsService.delete(campaignToDelete.value.id)
    toast.success(t('common.deletedSuccess', { resource: t('resources.Campaign') }))
    deleteDialogOpen.value = false
    campaignToDelete.value = null
    await fetchCampaigns()
  } catch (error: any) {
    toast.error(getErrorMessage(error, t('common.failedDelete', { resource: t('resources.campaign') })))
  } finally {
    isDeletingCampaign.value = false
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'completed':
      return CheckCircle
    case 'running':
    case 'processing':
    case 'queued':
      return Play
    case 'paused':
      return Pause
    case 'scheduled':
      return Clock
    case 'failed':
    case 'cancelled':
      return AlertCircle
    default:
      return Megaphone
  }
}

function getStatusClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'border-green-600 text-green-600'
    case 'running':
    case 'processing':
    case 'queued':
      return 'border-blue-600 text-blue-600'
    case 'failed':
    case 'cancelled':
      return 'border-destructive text-destructive'
    default:
      return ''
  }
}

function getProgressPercentage(campaign: Campaign): number {
  if (campaign.total_recipients === 0) return 0
  return Math.round((campaign.sent_count / campaign.total_recipients) * 100)
}

function campaignHasMedia(campaign: Campaign): boolean {
  return !!campaign.header_media_id
}

// Cache for media blob URLs and loading states
const mediaBlobUrls = ref<Record<string, string>>({})
const mediaLoadingState = ref<Record<string, 'loading' | 'loaded' | 'error'>>({})

async function loadMediaPreview(campaignId: string) {
  if (mediaLoadingState.value[campaignId]) return // Already loading or loaded

  mediaLoadingState.value[campaignId] = 'loading'
  try {
    const response = await campaignsService.getMedia(campaignId)
    const blob = new Blob([response.data], { type: response.headers['content-type'] })
    mediaBlobUrls.value[campaignId] = URL.createObjectURL(blob)
    mediaLoadingState.value[campaignId] = 'loaded'
  } catch (error) {
    console.error('Failed to load media preview:', error)
    mediaLoadingState.value[campaignId] = 'error'
  }
}

function getMediaPreviewUrl(campaignId: string): string {
  if (!mediaLoadingState.value[campaignId]) {
    loadMediaPreview(campaignId)
  }
  return mediaBlobUrls.value[campaignId] || ''
}

// Media preview dialog
const showMediaPreviewDialog = ref(false)
const previewingCampaign = ref<Campaign | null>(null)

function openMediaPreview(campaign: Campaign) {
  previewingCampaign.value = campaign
  showMediaPreviewDialog.value = true
}
</script>

<template>
  <div class="flex flex-col h-full bg-[#0a0a0b] light:bg-gray-50">
    <PageHeader
      :title="$t('campaigns.title')"
      :subtitle="$t('campaigns.subtitle')"
      :icon="Megaphone"
      icon-gradient="bg-gradient-to-br from-rose-500 to-pink-600 shadow-rose-500/20"
    >
      <template #actions>
        <RouterLink to="/campaigns/new">
          <Button variant="outline" size="sm">
            <Plus class="h-4 w-4 mr-2" />
            {{ $t('campaigns.createCampaign') }}
          </Button>
        </RouterLink>
      </template>
    </PageHeader>

    <!-- Campaigns List -->
    <ScrollArea class="flex-1">
      <div class="p-6">
        <div>
          <Card>
            <CardHeader>
              <div class="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle>{{ $t('campaigns.yourCampaigns') }}</CardTitle>
                  <CardDescription>{{ $t('campaigns.yourCampaignsDesc') }}</CardDescription>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                  <Select v-model="filterStatus">
                    <SelectTrigger class="w-[140px]">
                      <SelectValue :placeholder="$t('campaigns.allStatuses')" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
                        {{ opt.label }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Select v-model="selectedRange">
                    <SelectTrigger class="w-[140px]">
                      <SelectValue :placeholder="$t('campaigns.selectRange')" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">{{ $t('campaigns.today') }}</SelectItem>
                      <SelectItem value="7days">{{ $t('campaigns.last7Days') }}</SelectItem>
                      <SelectItem value="30days">{{ $t('campaigns.last30Days') }}</SelectItem>
                      <SelectItem value="this_month">{{ $t('campaigns.thisMonth') }}</SelectItem>
                      <SelectItem value="custom">{{ $t('campaigns.customRange') }}</SelectItem>
                    </SelectContent>
                  </Select>
                  <SearchInput v-model="searchQuery" :placeholder="$t('campaigns.searchCampaigns') + '...'" class="w-48" />
                  <Popover v-if="selectedRange === 'custom'" v-model:open="isDatePickerOpen">
                    <PopoverTrigger as-child>
                      <Button variant="outline" size="sm">
                        <CalendarIcon class="h-4 w-4 mr-1" />
                        {{ formatDateRangeDisplay || $t('common.select') }}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent class="w-auto p-4" align="end">
                      <div class="space-y-4">
                        <RangeCalendar v-model="customDateRange" :number-of-months="2" />
                        <Button class="w-full" size="sm" @click="applyCustomRange" :disabled="!customDateRange.start || !customDateRange.end">
                          {{ $t('campaigns.applyRange') }}
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ErrorState
                v-if="error && !isLoading"
                :title="$t('campaigns.fetchFailedTitle')"
                :description="error"
                :retry-label="$t('common.retry')"
                @retry="fetchCampaigns"
              />
              <DataTable
                v-else
                :items="campaigns"
                :columns="columns"
                :is-loading="isLoading"
                :empty-icon="Megaphone"
                :empty-title="searchQuery ? $t('campaigns.noMatchingCampaigns') : $t('campaigns.noCampaignsYet')"
                :empty-description="searchQuery ? $t('campaigns.noMatchingCampaignsDesc') : $t('campaigns.noCampaignsYetDesc')"
                v-model:sort-key="sortKey"
                v-model:sort-direction="sortDirection"
                server-pagination
                :current-page="currentPage"
                :total-items="totalItems"
                :page-size="pageSize"
                item-name="campaigns"
                @page-change="handlePageChange"
              >
                <template #cell-name="{ item: campaign }">
                  <div>
                    <div class="flex items-center gap-1.5">
                      <RouterLink :to="`/campaigns/${campaign.id}`" class="font-medium text-inherit no-underline hover:opacity-80">{{ campaign.name }}</RouterLink>
                      <ImageIcon v-if="campaignHasMedia(campaign)" class="h-3.5 w-3.5 text-muted-foreground cursor-pointer hover:text-foreground" :title="campaign.header_media_filename" @click.stop="openMediaPreview(campaign)" />
                    </div>
                    <p class="text-xs text-muted-foreground">{{ campaign.template_name || $t('campaigns.noTemplate') }}</p>
                  </div>
                </template>
                <template #cell-status="{ item: campaign }">
                  <Badge variant="outline" :class="[getStatusClass(campaign.status), 'text-xs']">
                    <component :is="getStatusIcon(campaign.status)" class="h-3 w-3 mr-1" />
                    {{ campaign.status }}
                  </Badge>
                </template>
                <template #cell-stats="{ item: campaign }">
                  <div class="space-y-1">
                    <div v-if="campaign.status === 'running' || campaign.status === 'processing'" class="w-32">
                      <Progress :model-value="getProgressPercentage(campaign)" class="h-1.5" />
                      <span class="text-xs text-muted-foreground">{{ getProgressPercentage(campaign) }}%</span>
                    </div>
                    <div class="flex items-center gap-3 text-xs">
                      <span title="Recipients"><Users class="h-3 w-3 inline mr-0.5" />{{ campaign.total_recipients }}</span>
                      <span class="text-green-600" title="Delivered">{{ campaign.delivered_count }}</span>
                      <span class="text-blue-600" title="Read">{{ campaign.read_count }}</span>
                      <span v-if="campaign.failed_count > 0" class="text-destructive" title="Failed">{{ campaign.failed_count }}</span>
                    </div>
                  </div>
                </template>
                <template #cell-created_at="{ item: campaign }">
                  <span class="text-muted-foreground text-sm">{{ formatDate(campaign.created_at) }}</span>
                </template>
                <template #cell-actions="{ item: campaign }">
                  <div class="flex items-center justify-end gap-1">
                    <RouterLink :to="`/campaigns/${campaign.id}`"><IconButton :icon="Pencil" :label="$t('campaigns.editCampaign')" class="h-8 w-8" /></RouterLink>
                    <IconButton
                      :icon="Trash2"
                      :label="$t('campaigns.deleteCampaign')"
                      class="h-8 w-8 text-destructive"
                      :disabled="campaign.status === 'running' || campaign.status === 'processing'"
                      @click="openDeleteDialog(campaign)"
                    />
                  </div>
                </template>
                <template #empty-action>
                  <RouterLink v-if="!searchQuery" to="/campaigns/new">
                    <Button variant="outline" size="sm">
                      <Plus class="h-4 w-4 mr-2" />
                      {{ $t('campaigns.createCampaign') }}
                    </Button>
                  </RouterLink>
                </template>
              </DataTable>
            </CardContent>
          </Card>
        </div>
      </div>
    </ScrollArea>

    <DeleteConfirmDialog
      v-model:open="deleteDialogOpen"
      :title="$t('campaigns.deleteCampaign')"
      :item-name="campaignToDelete?.name"
      :is-submitting="isDeletingCampaign"
      @confirm="confirmDeleteCampaign"
    />

    <!-- Media Preview Dialog -->
    <Dialog v-model:open="showMediaPreviewDialog">
      <DialogContent class="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{{ $t('campaigns.mediaPreview') }}</DialogTitle>
          <DialogDescription>
            {{ previewingCampaign?.header_media_filename }}
            <span v-if="previewingCampaign?.header_media_mime_type" class="text-xs"> ({{ previewingCampaign.header_media_mime_type }})</span>
          </DialogDescription>
        </DialogHeader>
        <div class="flex items-center justify-center py-4">
          <img
            v-if="previewingCampaign?.header_media_mime_type?.startsWith('image/') && previewingCampaign?.id"
            :src="getMediaPreviewUrl(previewingCampaign.id)"
            :alt="previewingCampaign?.header_media_filename"
            class="max-w-full max-h-[60vh] object-contain rounded"
          />
          <video
            v-else-if="previewingCampaign?.header_media_mime_type?.startsWith('video/') && previewingCampaign?.id"
            :src="getMediaPreviewUrl(previewingCampaign.id)"
            controls
            class="max-w-full max-h-[60vh] rounded"
          />
          <div v-else class="flex flex-col items-center gap-3 py-6 text-muted-foreground">
            <FileText class="h-16 w-16" />
            <span class="text-sm font-medium">{{ previewingCampaign?.header_media_filename }}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showMediaPreviewDialog = false">{{ $t('common.close') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
