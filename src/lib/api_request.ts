import axios, { Method } from 'axios';
import debug from 'debug';
import { v4 as uuidv4 }  from 'uuid';
import { AfterShip } from '../index';
import { VERSION } from './version';
import { AftershipError } from '../error/error';

const debugMakeRequest = debug('aftership:makeRequest');
const debugProcessResponse = debug('aftership:processResponse');
const debugProcessException = debug('aftership:processException');
const debugRateLimiting = debug('aftership:setRateLimiting');

const TIMEOUT = 50000;

interface RequestConfig {
  method: Method;
  url: string;
}

/**
 * API request interface
 */
export interface ApiRequest {
  /**
   * Make the request to AfterShip API
   * @param config the config of request (f.e. url, method)
   * @param data data
   */
  makeRequest<T, R>(
    { url, method }: RequestConfig,
    data?: T,
  ): Promise<R>;
}

/**
 * The implementation of API request
 */
export class ApiRequestImplementation implements ApiRequest {
  private readonly app: AfterShip;

  constructor(app: AfterShip) {
    this.app = app;
  }

  /**
   * Make a request call to AfterShip API
   * @param config the config of request (f.e. url, method)
   * @param data data
   */
  public makeRequest<T, R>(
    { url, method }: RequestConfig,
    data?: T,
  ): Promise<R> {
    debugMakeRequest('config %o', {
      url,
      method,
      apiKey: this.app.apiKey,
    });

    const request_id = uuidv4();
    const headers: any = {
      'aftership-api-key': this.app.apiKey,
      'Content-Type': 'application/json',
      'request-id': request_id,
      'aftership-agent': `nodejs-sdk-${VERSION}`,
    };

    // Only set User-Agent header in Node
    if (typeof window === 'undefined') {
      headers['User-Agent'] = `${this.app.user_agent_prefix}/${VERSION}`;
    }

    const request = axios.request({
      url,
      method,
      headers,
      baseURL: this.app.endpoint,
      data: data !== undefined ? { ...data } : undefined,
      timeout: TIMEOUT,
    });

    // return Promise
    return new Promise((resolve, reject) => {
      request
        .then(({ headers, data }) => {
          this.setRateLimiting(this.app, headers);
          resolve(this.processResponse(data));
        })
        .catch(e => reject(this.processException(e)));
    });
  }

  private processResponse<R>(data: any): R {
    debugProcessResponse('body %o', data);

    // Return data in response
    return data['data'];
  }

  private processException(error: any): AftershipError {
    debugProcessException('UnexpectedError %s', error.message);
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      if (error.response.status !== 401) {
        // Not UnauthorizedError
        // Set rate_limit
        this.setRateLimiting(this.app, error.response.headers);
      }
      return AftershipError.getApiError(error.response.data);
    }

    if (error.request) {
      // The request was made but no response was received
      // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
      // http.ClientRequest in node.js
      return AftershipError.getRequestError(error, error.config);
    }

    // Something happened in setting up the request that triggered an Error
    return new AftershipError('Setup Request Error', error.message);
  }

  private setRateLimiting(app: AfterShip, data: any): void {
    if (!data) {
      return;
    }

    const rateLimiting = {
      reset: data['x-ratelimit-reset'],
      limit: data['x-ratelimit-limit'],
      remaining: data['x-ratelimit-remaining'],
    };

    debugRateLimiting('rateLimiting %o', rateLimiting);
    app.rate_limit = rateLimiting;
  }
}
