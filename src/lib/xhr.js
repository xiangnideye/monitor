// 【当前模块监听 xhr 请求】

import {isFormData, isBlob, isArrayBuffer} from '../utils'
import tracker from './tracker'

// 传递给 xhr.open 的参数有以下几种类型：null、string、formData、blob、arrayBuffer。
// 需要注意的是，如果 content-type: application/json，xhr.open 的参数是对象经过 JSON.stringify 之后的字符串
function getParams(param) {
  if (!param || isFormData(param) || isBlob(param) || isArrayBuffer(param)) return ''

  return param
}

/**
 * xhr 实现思路：重写 xhr 的 open 和 send 方法，用于收集请求数据，再监听 ajax 的4种异常情况，进行错误收集。
 * 
 * ajax 异常的情况有4种
 * - abort
 * - timeout
 * - 网络错误 error
 * - 成功请求但是服务端返回的状态码不满足 200 <= xhr.status < 300 或 304
 */
export function injectXHR() {
  const open = XMLHttpRequest.prototype.open
  const send = XMLHttpRequest.prototype.send

  // 注意：async 值如果没有赋值，需要默认为 true
  XMLHttpRequest.prototype.open = function (method, url, async = true, username, password) {
    this.logData = {method, url}
    return open.call(this, method, url, async, username, password)
  }

  XMLHttpRequest.prototype.send = function (param) {
    const {method, url} = this.logData

    const startTime = Date.now()
    function createHandler(eventType) {
      return function () {
        const {responseType, status, statusText, response} = this
        // 加载成功并且 200 <= xhr.status < 300 或者 xhr.status === 304，则不做任何上报
        if (
          eventType === 'loadError'
          && ((status >= 200 && status < 300) || status === 304)
        ) return

        // abort、timeout、网络异常error、http 的状态码代表非正常时，进行上报
        const data = {
          kind: 'stability',
          type: 'xhr',
          eventType,
          method,
          url,
          params: getParams(param),
          status: `${status} - ${statusText}`,
          response: response || '',
          duration: Date.now() - startTime
        }

        const isBlobRes = responseType === 'blob'

        // 服务端报错时，报错信息被转 blob 或 arrayBuffer，需要解析出来
        if (eventType === 'loadError') {
          const isArrayBufferRes = responseType === 'arraybuffer'

          // 解码 arraybuffer 数据
          if (isArrayBufferRes) {
            const decoder = new TextDecoder()
            data.response = decoder.decode(response)
          }

          // 解码 blob 数据
          if (isBlobRes) {
            const fileReader = new FileReader()
            fileReader.onload = function() {
              data.response = this.result
              tracker(data)
            }
            fileReader.readAsText(response)
          }
        }

        // 如果是返回的是 blob，会在 blob 解码之后去上传
        if (isBlobRes) return
        tracker(data)
      }
    }

    this.addEventListener('abort', createHandler('abort'), false)
    this.addEventListener('timeout', createHandler('timeout'), false)
    this.addEventListener('error', createHandler('error'), false)
    this.addEventListener('load', createHandler('loadError'), false)
    
    return send.call(this, param)
  }
}
