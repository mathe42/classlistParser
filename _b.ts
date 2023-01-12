/**
 * TODO: 
 * 1. HTML script tag parsen 
 * 2. class toggels etc parsen
 * 3. innerHTML
 */

type PHPHTML = 'php' | 'html' | 'js' | 'php-string' | 'php-string-html' | 'php-line-comment' | 'php-block-comment'
type PHPHTML_CLASS = PHPHTML | `${PHPHTML}-classList` | 'classList-start' | 'classList-end'
type Quote = "'" | '"'

type Res<T extends string> = {content: string, mode: T}

type ResWithPos<T extends string> = {
  content: string,
  mode: T,
  pos: {
    line: number,
    col: number
  }
}

const __SCRIPT_START__ = '<script'
const __SCRIPT_END__ = '</script>'
class PHPHTMLParser extends TransformStream<string, Res<PHPHTML>> {
  build = ''
  mode: PHPHTML = 'html'
  nextCharEscape = false
  stringContext: Quote | false = false

  commentStartChar = false
  lineComment = false

  changeTag = false
  endCommentChar = false

  scriptTagIndex = 0;

  constructor() {
    super({
      transform: (chunk, ctx) => {
        if(this.mode === 'js') {
          this.build += chunk
          if(chunk === __SCRIPT_END__[this.scriptTagIndex]) {
            this.scriptTagIndex++

            if(this.scriptTagIndex === __SCRIPT_END__.length) {
              this.mode = 'html'
              this.scriptTagIndex = 0

              ctx.enqueue({
                content: this.build,
                mode: 'js'
              })
              this.build = ''
              return
            }
          } else {
            this.scriptTagIndex = 0
          }
        }

        if(this.mode === 'html') {
          if(chunk === __SCRIPT_START__[this.scriptTagIndex]) {
            this.scriptTagIndex++

            if(this.scriptTagIndex === __SCRIPT_START__.length) {
              this.mode = 'js'
              this.scriptTagIndex = 0

              ctx.enqueue({
                content: this.build.slice(0, this.build.length - __SCRIPT_START__.length + 1),
                mode: 'html'
              })
              this.build = __SCRIPT_START__
              return
            }
          } else {
            this.scriptTagIndex = 0
          }

          if(this.changeTag) {
            if(chunk === '?') {
              this.mode = 'php'
              ctx.enqueue({
                content: this.build,
                mode: 'html'
              })
              this.build = '<?'
              return
            } else {
              this.build += '<'
              this.changeTag = false
            }
          }

          if(chunk === '<') {
            this.changeTag = true
          } else {             
            this.build += chunk
          }
        }

        if(this.mode === 'php-line-comment') {
          this.build += chunk;
          if(this.changeTag) {
            if(chunk === '>') {
              this.mode = 'html'
              ctx.enqueue({
                content: this.build.slice(0, this.build.length - 2),
                mode: 'php-line-comment'
              })
              ctx.enqueue({
                content: '?>',
                mode: 'php'
              })
              this.build = ''
              return
            }
          }
          if(chunk === '?') {
            this.changeTag = true
          } else {
            this.changeTag = false
          }
          if(chunk === '\n') {
            this.mode = 'php'
            ctx.enqueue({
              content: this.build,
              mode: 'php-line-comment'
            })
            this.build = ''
          }
          return
        }

        if(this.mode === 'php-block-comment') {
          this.build += chunk;
          if(this.endCommentChar && chunk === '/') {
            this.mode = 'php'
            ctx.enqueue({
              content: this.build,
              mode: 'php-block-comment'
            })
            this.build = ''
          }
          this.endCommentChar = false

          if(chunk === '*') {
            this.endCommentChar = true
          }
          return
        }

        if(this.mode === 'php') {
          if(this.commentStartChar) {
            this.commentStartChar = false

            if(chunk === '/') {
              ctx.enqueue({
                content: this.build.slice(0, this.build.length - 1),
                mode: 'php'
              })
              this.build = '//'
              this.mode = 'php-line-comment'
              this.nextCharEscape = false
              this.changeTag = false
              return
            }

            if(chunk === '*') {
              ctx.enqueue({ 
                content: this.build.slice(0, this.build.length - 1),
                mode: 'php'
              })
              this.build = '/*'
              this.mode = 'php-block-comment'
              this.nextCharEscape = false
              this.changeTag = false
              return
            }
          }

          this.commentStartChar = false

          if(chunk === '/') {
            this.commentStartChar = true
          }

          if(chunk === '"' || chunk === "'") {
            this.stringContext = chunk
            this.mode = 'php-string'

            ctx.enqueue({
              content: this.build,
              mode: 'php'
            })

            this.build = chunk

            return
          }

          this.build += chunk;

          if(chunk === '?') {
            this.changeTag = true
            return
          }
          if(chunk === '>' && this.changeTag) {
            this.mode = 'html'
            ctx.enqueue({
              content: this.build,
              mode: 'php'
            })
            this.build = ''
          }
          this.changeTag = false
        } else {
          this.commentStartChar = false
        }

        if(this.mode === 'php-string') {
          this.build += chunk;

          if(chunk === this.stringContext && !this.nextCharEscape) {
            this.stringContext = false
            this.mode = 'php'

            const isHTML = /([\s]|(^['"]))class=/.test(this.build) || (this.build.includes('>') && this.build.includes('</') )

            ctx.enqueue({
              content: this.build,
              mode: isHTML ? 'php-string-html' : 'php-string'
            })
            this.build = ''
            return
          }
          if(chunk === '\\') {
            this.nextCharEscape = true
            return
          }
          this.nextCharEscape = false
        }
      },
      flush: (ctx) => {
        ctx.enqueue({
          content: this.build,
          mode: this.mode
        })
      }
    })
  }
}

let c = 0

class PHPHTMLParserClassList extends TransformStream<Res<PHPHTML>, Res<PHPHTML_CLASS>> {
  inHTMLClassName = false
  inPHPClassName = false
  quoteMode: string | null = ''

  constructor() {
    super({
      transform: (chunk, ctx) => {
        if(this.inPHPClassName && (chunk.mode === 'php-string' || chunk.mode === 'php-string-html')) {
          const map = {
            "'": {
              "'": "\\'",
              '"': "'"
            },
            '"': {
              "'": '"',
              '"': '\\"'
            },
            "\\'": {
              "'": "\\'",
              '"': "'"
            },
            '\\"': {
              "'": '"',
              '"': '\\"'
            },
          } as const
          const quoteMode = map[this.quoteMode as keyof typeof map][chunk.content[0] as (keyof typeof map["\""])]


          if(chunk.content.slice(1, chunk.content.length - 2).includes(quoteMode)) {

            const pos = chunk.content.slice(1, chunk.content.length - 2).indexOf(quoteMode) + 1


            ctx.enqueue({
              content: chunk.content.slice(0, pos),
              mode: chunk.mode + '-classList' as PHPHTML_CLASS
            })
            ctx.enqueue({
              content: '',
              mode: 'classList-end'
            })

            this.inPHPClassName = false
            this.quoteMode  =''

            chunk.content = chunk.content.slice(pos)

            // console.log('XXX', chunk.content[pos])
          } else {
            ctx.enqueue({
              content: chunk.content,
              mode: chunk.mode + '-classList' as PHPHTML_CLASS
            })
            return
          }

          // console.log(this.quoteMode, chunk.content.slice(0, 4))
        }
        if(!this.inHTMLClassName && !this.inPHPClassName && chunk.mode === 'php-string-html') {
          const [
            first,
            ...classLists
          ] = chunk.content.split('class=')

          ctx.enqueue({
            content: first,
            mode: 'php-string-html'
          })

          

          if(classLists.length > 0) {
            const quoteType = first[0] as '"' | "'"

            const reverseQuoteMapping = {
              "'": '"',
              '"': "'"
            } as const

            classLists.forEach((el) => {
              const quoteMode = el.trim()[0] === "\\" ? "\\" + quoteType : reverseQuoteMapping[quoteType]
              const startTrim = el.slice(0, el.length - el.trimStart().length)

              ctx.enqueue({
                content: "class=" + startTrim + quoteMode,
                mode: 'php-string-html'
              })

              const restCheck = el.slice((startTrim + quoteMode).length)

              const [classNames, ...rest] = restCheck.split(quoteMode)


              // console.log(classNames)
              ctx.enqueue({
                content: '',
                mode: 'classList-start'
              })
              c++

              ctx.enqueue({
                content: classNames,
                mode: 'php-string-html-classList'
              })

              if(rest.length > 0) {
                ctx.enqueue({
                  content: '',
                  mode: 'classList-end'
                })

                ctx.enqueue({
                  content: quoteMode + rest.join(quoteMode),
                  mode: 'php-string'
                })
              } else {
                this.inPHPClassName = true
                this.quoteMode = quoteMode
              }
            })
          }
          return
        } else if(this.inHTMLClassName && chunk.mode === 'html' && chunk.content.includes(this.quoteMode!)) {
          ctx.enqueue({
            content: chunk.content.slice(0, chunk.content.indexOf(this.quoteMode!)),
            mode: 'html-classList'
          })
          ctx.enqueue({
            content: '',
            mode: 'classList-end'
          })
          chunk.content = chunk.content.slice(chunk.content.indexOf(this.quoteMode!))
          this.inHTMLClassName = false
          this.quoteMode = ''
        } 
        if(this.inHTMLClassName || this.inPHPClassName) {
          ctx.enqueue({
            content: chunk.content,
            mode: chunk.mode + '-classList' as PHPHTML_CLASS
          })
          return
        }
        if(!this.inHTMLClassName && chunk.mode === 'html' && chunk.content.includes('class=')) {
          let restHTML = chunk.content
          while(restHTML.indexOf('class=') !== -1) {
            let idx = restHTML.indexOf('class=') + 'class='.length;


            
            idx += restHTML.slice(idx).length - restHTML.slice(idx).trimStart().length

            this.quoteMode = restHTML[idx]
            this.inHTMLClassName = true

            
            // if(restHTML.slice(idx + 1).length - restHTML.slice(idx + 1).trimStart().length) {
            //   alert(restHTML.slice(0, idx + 1))
            //   alert(restHTML.slice(idx + 1))
            // }
            

            ctx.enqueue({
              content: restHTML.slice(0, idx + 1),
              mode: 'html'
            })

            ctx.enqueue({
              content: '',
              mode: 'classList-start'
            })
            c++

            restHTML = restHTML.slice(idx + 1)

            if(restHTML.indexOf(this.quoteMode) !== -1) {
              ctx.enqueue({
                content: restHTML.slice(0, restHTML.indexOf(this.quoteMode)),
                mode: 'html-classList'
              })

              ctx.enqueue({
                content: '',
                mode: 'classList-end'
              })

              restHTML = restHTML.slice(restHTML.indexOf(this.quoteMode))
              this.quoteMode = ''
              this.inHTMLClassName = false
            } else {              
              ctx.enqueue({
                content: restHTML,
                mode: 'html-classList'
              })

              restHTML = ''
            }
          }

          if(restHTML) {
            ctx.enqueue({
              content: restHTML,
              mode: 'html'
            })
          }
          

          return
        }

        ctx.enqueue(chunk)
      }
    })
  }
}

class ADD_POS extends TransformStream<Res<PHPHTML_CLASS>, ResWithPos<PHPHTML_CLASS>> {
  lines = 1
  pos = 0

  constructor() {
    super({
      transform: (chunk, ctx) => {
        ctx.enqueue({
          ...chunk,
          pos: {
            line: this.lines,
            col: this.pos
          }
        })

        const data = chunk.content.split('\n')

        this.lines += (data.length - 1)
        if(data.length > 1) {
          this.pos = data.at(-1)!.length
        } else {
          this.pos += chunk.content.length
        }

      }
    })
  }
}


class Combine extends TransformStream<ResWithPos<PHPHTML_CLASS>, ResWithPos<PHPHTML_CLASS>[]> {
  list: ResWithPos<PHPHTML_CLASS>[] = []

  constructor() {
    super({
      transform: (chunk, ctx) => {
        if(chunk.mode === 'classList-end' || chunk.mode === 'classList-start') {
          ctx.enqueue(this.list)
          this.list = []  
        } else {
          this.list.push(chunk)
        }
      },
      flush: (ctx) => {
        ctx.enqueue(this.list)
      }
    })
  }
}

const cc : any = {}
for (let i = 0; i < 25; i++) {
  cc[i] = 0
}


class ClassSeperator extends TransformStream<ResWithPos<PHPHTML_CLASS>[], {
  mode: 'class' | 'code',
  code: ResWithPos<PHPHTML_CLASS>[]
}> {
  lastWasClass = true

  constructor() {
    super({
      transform: (chunk, ctx) => {
        chunk = chunk.filter(v=>v.content !== '')
        if(this.lastWasClass) {
          ctx.enqueue({
            mode: 'code',
            code: chunk
          })
        } else {
          if(chunk.length > 0) {
            ctx.enqueue({
              mode: 'class',
              code: []
            })
            cc[chunk.length]++
          }
          // 22 OK
          // 15 OK
          // 13 OK
          // 12 Refactor table_pagenavi_bottom.inc.php
          // 11 Refactor base_user_complete_subscription_jahrmonat.inc.php
          // 10 OK
          // 9 Refactor base_user_refund_check.inc.php
          // 8 --
          // 7 OK
          // 6 --
          // 5 --
          // 4 --
          // 3 Refactor base_user_subscription_jahrmonat_pagination.inc.php; header.inc.php
          // 2 --
          // if(chunk.length === 5) console.log(chunk)

          // if(chunk.length === 1 && chunk[0].content.includes('$')) {
          //   console.log(chunk[0].content)
          // }
        }

        this.lastWasClass = !this.lastWasClass
      }
    })
  }
}

const s = new Set<string>()


class ClassParser extends TransformStream<{
  mode: 'class' | 'code',
  code: ResWithPos<PHPHTML_CLASS>[]
}, {
  mode: 'code',
  code: ResWithPos<PHPHTML_CLASS>[]
} | {
  mode: 'class',
  classList: ResWithPos<PHPHTML_CLASS>[][]
}> {
  lastWasClass = true

  constructor() {
    super({
      transform: (chunk, ctx) => {
        if(chunk.mode === "code") {
          ctx.enqueue(chunk as any)
          return
        }

        // if(chunk.code.length === 1) {
        //   ctx.enqueue({
        //     mode: 'class',
        //     classList: chunk.code[0]
        //       .content
        //       .split(/\s/g)
        //       .filter(Boolean)
        //       .map((className, i)=>([{
        //         ...chunk.code[0],
        //         content: (i===0 ? '' : ' ') + className
        //       }]))
        //   })
        //   return
        // }

        // for (const part of chunk.code) {
        //   console.log(part)
          

        //   alert()
        // }


        // console.log(chunk)
        // // alert()

        ctx.enqueue({
          mode: 'class',
          classList: [
            chunk.code
          ]
        })

        // console.log(chunk.code)
        // s.add()
        s.add(chunk.code.map(v=>v.content).join(''))

        // alert("TEST")

      }
    })
  }
}

function doMagic(code: string) {
  const t1 = new PHPHTMLParser();
  const t2 = new PHPHTMLParserClassList()
  const t3 = new ADD_POS()
  const t4 = new Combine()
  const t5 = new ClassSeperator()
  const t6 = new ClassParser()
  // const t2 = new TransformStream()
  t1.readable
    .pipeThrough(t2)
    .pipeThrough(t3)
    .pipeThrough(t4)
    .pipeThrough(t5)
    .pipeThrough(t6)
  

  const d = (async () => {
    const reader = t6.readable.getReader();
    const l: ({
      mode: 'code',
      code: ResWithPos<PHPHTML_CLASS>[]
    } | {
      mode: 'class',
      classList: ResWithPos<PHPHTML_CLASS>[][]
    })[] = []
    while (true) {
      const {done, value} = await reader.read()
  
      if(done) break
      l.push(value)
    }
    return l
  })();
  
  const w = t1.writable.getWriter()
  
  code.split('').forEach(chr => {
    w.write(chr)
  })
  w.close()
 
  return d
}

const results: ({
  mode: 'code',
  code: ResWithPos<PHPHTML_CLASS>[]
} | {
  mode: 'class',
  classList: ResWithPos<PHPHTML_CLASS>[][]
})[][] = []

for (const el of Deno.readDirSync('.')) {
  if(el.name.endsWith('.php')) {
    // console.log(el.name)
    const code = Deno.readTextFileSync('./' + el.name)
    const data = await doMagic(code)

    const code2 = data.flat(2).map(v=>v.mode === 'class' ? v.classList : v.code).flat(2).map(v=>v.content).join('')

    Deno.writeTextFileSync('./' + el.name + '.json', JSON.stringify(data, null, 2))

    results.push(data)

    if(code !== code2) {
      console.log(el.name)
      Deno.writeTextFileSync('./' + el.name, code2)
    }

  }
}

// console.log(results.flat(2).map(v=>v.mode === 'class' ? v.classList : v.code).flat(2).length)

// console.log(c)

// console.log(cc)

// console.log(JSON.stringify([...s], null, 2))

const ss = [...s]//.filter(v=>v.includes('\n'))
console.log(ss.map(v=>v.replaceAll(/[\n\r]/g, ' ')).join('\n'))