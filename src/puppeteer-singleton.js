/**
 * puppeteer-singleton.js — 共享 Puppeteer 实例
 *
 * browser.js 和 engine.js 都使用 puppeteer-extra + stealth 插件，
 * 共享同一个增强后的实例避免重复注册插件。
 */
import puppeteerCore from 'puppeteer-core';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

export default puppeteer;
