class DomainChecker {
  async check(domainUrl) {
    const url = this.normalizeUrl(String(domainUrl || ''));

    if (!/^https?:\/\/[^ "]+$/i.test(url)) {
      return {
        ok: false,
        status: 0,
        message: 'Invalid URL.'
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      let response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal
      });

      if ([405, 403].includes(response.status)) {
        response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal
        });
      }

      return {
        ok: response.ok,
        status: response.status,
        finalUrl: response.url,
        message: response.ok ? 'Domain reachable.' : `Domain returned HTTP ${response.status}.`
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        message: error instanceof Error ? error.message : String(error)
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  normalizeUrl(value) {
    return value.trim();
  }
}

export default DomainChecker;
