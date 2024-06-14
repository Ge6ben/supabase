import type { QueryKey, UseQueryOptions } from '@tanstack/react-query'

import { IS_PLATFORM } from 'common'
import { Filter, Query, Sort, SupaRow, SupaTable } from 'components/grid'
import {
  JSON_TYPES,
  TEXT_TYPES,
} from 'components/interfaces/TableGridEditor/SidePanelEditor/SidePanelEditor.constants'
import { KB } from 'lib/constants'
import {
  ImpersonationRole,
  ROLE_IMPERSONATION_NO_RESULTS,
  wrapWithRoleImpersonation,
} from 'lib/role-impersonation'
import { useIsRoleImpersonationEnabled } from 'state/role-impersonation-state'
import {
  ExecuteSqlData,
  ExecuteSqlError,
  executeSql,
  useExecuteSqlQuery,
} from '../sql/execute-sql-query'
import { getPagination } from '../utils/pagination'
import { formatFilterValue } from './utils'

type GetTableRowsArgs = {
  table?: SupaTable
  filters?: Filter[]
  sorts?: Sort[]
  limit?: number
  page?: number
  impersonatedRole?: ImpersonationRole
}

// [Joshen] We can probably make this reasonably high, but for now max aim to load 10kb
export const MAX_CHARACTERS = 10 * KB

export const fetchAllTableRows = async ({
  projectRef,
  connectionString,
  table,
  filters = [],
  sorts = [],
  impersonatedRole,
}: {
  projectRef: string
  connectionString?: string
  table: SupaTable
  filters?: Filter[]
  sorts?: Sort[]
  impersonatedRole?: ImpersonationRole
}) => {
  if (IS_PLATFORM && !connectionString) {
    console.error('Connection string is required')
    return []
  }

  const rows: any[] = []
  const query = new Query()

  let queryChains = query.from(table.name, table.schema ?? undefined).select()
  filters
    .filter((filter) => filter.value && filter.value !== '')
    .forEach((filter) => {
      const value = formatFilterValue(table, filter)
      queryChains = queryChains.filter(filter.column, filter.operator, value)
    })
  sorts.forEach((sort) => {
    queryChains = queryChains.order(sort.table, sort.column, sort.ascending, sort.nullsFirst)
  })

  // Starting from page 0, fetch 500 records per call
  let page = -1
  let from = 0
  let to = 0
  let pageData = []
  const rowsPerPage = 500

  await (async () => {
    do {
      page += 1
      from = page * rowsPerPage
      to = (page + 1) * rowsPerPage - 1
      const query = wrapWithRoleImpersonation(queryChains.range(from, to).toSql(), {
        projectRef,
        role: impersonatedRole,
      })

      try {
        const { result } = await executeSql({ projectRef, connectionString, sql: query })
        rows.push(...result)
        pageData = result
      } catch (error) {
        return { data: { rows: [] } }
      }
    } while (pageData.length === rowsPerPage)
  })()

  return rows.filter((row) => row[ROLE_IMPERSONATION_NO_RESULTS] !== 1)
}

export const getTableRowsSqlQuery = ({
  table,
  filters = [],
  sorts = [],
  page,
  limit,
}: GetTableRowsArgs) => {
  const query = new Query()

  if (!table) return ``

  // [Joshen] Only truncate text/json based columns as their length could go really big
  // Note: Risk of payload being too large if the user has many many text/json based columns
  // although possibly negligible risk.
  const truncatedColumns = table.columns
    .filter((column) => {
      return (
        ((column?.enum ?? []).length > 0 && column.dataType.toLowerCase() === 'array') ||
        TEXT_TYPES.includes(column.format) ||
        JSON_TYPES.includes(column.format)
      )
    })
    .map((column) => {
      if ((column?.enum ?? []).length > 0 && column.dataType.toLowerCase() === 'array') {
        return `"${column.name}"::text[]`
      } else {
        return `case when length("${column.name}"::text) > ${MAX_CHARACTERS} then concat(left("${column.name}"::text, ${MAX_CHARACTERS}), '...') else "${column.name}"::text end "${column.name}"`
      }
    })

  let queryChains = query
    .from(table.name, table.schema ?? undefined)
    .select(truncatedColumns.length > 0 ? `*,${truncatedColumns.join(',')}` : '*')

  filters
    .filter((x) => x.value && x.value != '')
    .forEach((x) => {
      const value = formatFilterValue(table, x)
      queryChains = queryChains.filter(x.column, x.operator, value)
    })
  sorts.forEach((x) => {
    queryChains = queryChains.order(x.table, x.column, x.ascending, x.nullsFirst)
  })

  // getPagination is expecting to start from 0
  const { from, to } = getPagination((page ?? 1) - 1, limit)
  const sql = queryChains.range(from, to).toSql()

  return sql
}

export type TableRows = {
  rows: SupaRow[]
}

export type TableRowsVariables = GetTableRowsArgs & {
  projectRef?: string
  connectionString?: string
  queryKey?: QueryKey
}

export type TableRowsData = TableRows
export type TableRowsError = ExecuteSqlError

export const useTableRowsQuery = <TData extends TableRowsData = TableRowsData>(
  { projectRef, connectionString, queryKey, table, impersonatedRole, ...args }: TableRowsVariables,
  options: UseQueryOptions<ExecuteSqlData, TableRowsError, TData> = {}
) => {
  const isRoleImpersonationEnabled = useIsRoleImpersonationEnabled()

  return useExecuteSqlQuery(
    {
      projectRef,
      connectionString,
      sql: wrapWithRoleImpersonation(getTableRowsSqlQuery({ table, ...args }), {
        projectRef: projectRef ?? 'ref',
        role: impersonatedRole,
      }),
      queryKey: [
        ...(queryKey ?? []),
        {
          table: {
            name: table?.name,
            schema: table?.schema,
            columns: table?.columns.map((c) => c.name),
          },
          impersonatedRole,
          ...args,
        },
      ],
      isRoleImpersonationEnabled,
    },
    {
      select(data) {
        const rows = data.result.map((x: any, index: number) => {
          return { idx: index, ...x } as SupaRow
        })

        return {
          rows,
        } as TData
      },
      enabled: typeof projectRef !== 'undefined' && typeof table !== 'undefined',
      ...options,
    }
  )
}
