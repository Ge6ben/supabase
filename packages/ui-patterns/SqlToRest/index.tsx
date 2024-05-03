import Editor, { useMonaco } from '@monaco-editor/react'
import { stripIndent } from 'common-tags'
import { ChevronUp } from 'lucide-react'
import type { editor } from 'monaco-editor'
import { useTheme } from 'next-themes'
import {
  PropsWithChildren,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import Markdown from 'react-markdown'
import {
  HttpRequest,
  Statement,
  SupabaseJsQuery,
  processSql,
  renderHttp,
  renderSupabaseJs,
  uriEncode,
} from 'sql-to-rest'
import { CodeBlock, Collapsible, Tabs, cn } from 'ui'
import { Result, faqs } from './faqs'

const defaultValue = stripIndent`
  select
    title as "myTitle",
    description
  from
    books
  where
    description ilike '%cheese%'
  order by
    title desc
  limit
    5
  offset
    10
`

export interface SqlToRestProps {
  baseUrl?: string
}

export default function SqlToRest({ baseUrl = 'http://localhost:54321/rest/v1' }: SqlToRestProps) {
  const monaco = useMonaco()
  const { theme } = useTheme()
  const isDark = theme?.includes('dark') ?? true

  useLayoutEffect(() => {
    if (monaco && theme) {
      const lightMode = getTheme(false)
      const darkMode = getTheme(true)
      monaco.editor.defineTheme('supabase-light', lightMode)
      monaco.editor.defineTheme('supabase-dark', darkMode)
    }
  }, [theme, monaco])

  const [sql, setSql] = useState(defaultValue)
  const [statement, setStatement] = useState<Statement>()
  const [httpRequest, setHttpRequest] = useState<HttpRequest>()
  const [jsQuery, setJsQuery] = useState<SupabaseJsQuery>()
  const [errorMessage, setErrorMessage] = useState<string>()
  const [currentLanguage, setCurrentLanguage] = useState('http')

  const rawHttp = useMemo(() => {
    if (!httpRequest) {
      return
    }
    return formatHttp(baseUrl, httpRequest)
  }, [httpRequest, baseUrl])

  const curlCommand = useMemo(() => {
    if (!httpRequest) {
      return
    }
    return formatCurl(baseUrl, httpRequest)
  }, [httpRequest, baseUrl])

  const jsCommand = useMemo(() => {
    if (!jsQuery) {
      return
    }
    const { code } = jsQuery
    return code
  }, [jsQuery])

  const relevantFaqs = useMemo(() => {
    if (!statement) {
      return []
    }

    switch (currentLanguage) {
      case 'http':
      case 'curl': {
        if (!httpRequest) {
          return []
        }

        const result: Result = {
          type: 'http',
          language: currentLanguage,
          statement,
          ...httpRequest,
        }

        return faqs.filter((faq) => faq.condition(result))
      }
      case 'js': {
        if (!jsQuery) {
          return []
        }

        const result: Result = {
          type: 'supabase-js',
          language: currentLanguage,
          statement,
          ...jsQuery,
        }

        return faqs.filter((faq) => faq.condition(result))
      }
      default:
        return []
    }
  }, [currentLanguage, statement, httpRequest, jsQuery])

  const process = useCallback(async (sql: string) => {
    setSql(sql)

    try {
      const statement = await processSql(sql)
      const httpRequest = await renderHttp(statement)
      const jsQuery = await renderSupabaseJs(statement)

      setErrorMessage(undefined)
      setStatement(statement)
      setHttpRequest(httpRequest)
      setJsQuery(jsQuery)
    } catch (error) {
      if (!(error instanceof Error)) {
        console.error(error)
        return
      }

      setErrorMessage(error.message)
    }
  }, [])

  // Process initial value only
  useEffect(() => {
    process(sql)
  }, [process])

  return (
    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4 mt-4">
      <div className="flex flex-col gap-4">
        <div>Enter SQL to convert:</div>
        <div
          className={cn('h-96 py-4 border rounded-md', isDark ? 'bg-[#1f1f1f]' : 'bg-[#f0f0f0]')}
        >
          <Editor
            language="pgsql"
            theme={isDark ? 'supabase-dark' : 'supabase-light'}
            value={sql}
            options={{
              tabSize: 2,
              minimap: {
                enabled: false,
              },
              fontSize: 13,
            }}
            onChange={async (sql) => {
              if (!sql) {
                return
              }
              await process(sql)
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Tabs
          activeId={currentLanguage}
          onChange={(id: string) => setCurrentLanguage(id)}
          queryGroup="language"
        >
          <Tabs.Panel id="curl" label="cURL" className="flex flex-col gap-4">
            <CodeBlock language="curl" hideLineNumbers className="self-stretch">
              {curlCommand}
            </CodeBlock>
          </Tabs.Panel>
          <Tabs.Panel id="http" label="HTTP" className="flex flex-col gap-4">
            <CodeBlock language="http" hideLineNumbers className="self-stretch">
              {rawHttp}
            </CodeBlock>
          </Tabs.Panel>
          <Tabs.Panel id="js" label="JavaScript">
            <CodeBlock language="js" hideLineNumbers className="self-stretch">
              {jsCommand}
            </CodeBlock>
          </Tabs.Panel>
        </Tabs>
        {errorMessage && <div className="text-red-900">{errorMessage}</div>}

        {relevantFaqs.map((faq) => (
          <Collapsible
            key={faq.id}
            className="flex flex-col items-stretch justify-start bg-surface-100 rounded border border-default px-4"
          >
            <Collapsible.Trigger asChild>
              <button type="button" className="flex justify-between items-center p-3">
                <Markdown
                  className="text-sm text-left"
                  components={{
                    p: ({ children }: PropsWithChildren) => <p className="m-0">{children}</p>,
                  }}
                >
                  {faq.question}
                </Markdown>
                <ChevronUp className="transition data-open-parent:rotate-0 data-closed-parent:rotate-180" />
              </button>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div className="text-foreground flex flex-col justify-start items-center px-3 pb-4">
                <Markdown
                  className="text-sm"
                  components={{
                    code: (props: any) => <CodeBlock hideLineNumbers {...props} />,
                  }}
                >
                  {faq.answer}
                </Markdown>
              </div>
            </Collapsible.Content>
          </Collapsible>
        ))}
      </div>
    </div>
  )
}

// TODO: this was copied from studio - find a way to share it between sites
function getTheme(isDarkMode: boolean): editor.IStandaloneThemeData {
  return {
    base: isDarkMode ? 'vs-dark' : 'vs', // can also be vs-dark or hc-black
    inherit: true, // can also be false to completely replace the builtin rules
    rules: [
      {
        token: '',
        background: isDarkMode ? '1f1f1f' : 'f0f0f0',
        foreground: isDarkMode ? 'd4d4d4' : '444444',
      },
      { token: 'string.sql', foreground: '24b47e' },
      { token: 'comment', foreground: '666666' },
      { token: 'predefined.sql', foreground: isDarkMode ? 'D4D4D4' : '444444' },
    ],
    colors: { 'editor.background': isDarkMode ? '#1f1f1f' : '#f0f0f0' },
  }
}

function formatHttp(baseUrl: string, httpRequest: HttpRequest) {
  const { method, fullPath } = httpRequest
  const baseUrlObject = new URL(baseUrl)

  return stripIndent`
    ${method} ${baseUrlObject.pathname}${fullPath} HTTP/1.1
    Host: ${baseUrlObject.host}
  `
}

function formatCurl(baseUrl: string, httpRequest: HttpRequest) {
  const { method, path, params } = httpRequest
  const lines: string[] = []
  const baseUrlObject = new URL(baseUrl)

  if (method === 'GET') {
    lines.push(`curl -G ${baseUrlObject.toString()}${path}`)
    for (const [key, value] of params) {
      lines.push(`  -d "${uriEncode(key)}=${uriEncode(value)}"`)
    }
  }

  return lines.join(' \\\n')
}
