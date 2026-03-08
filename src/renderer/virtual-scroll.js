/**
 * 虚拟滚动列表控件
 * 只渲染当前可视区域的项，滚动时动态计算并更新
 */
class VirtualScrollList {
    constructor(options) {
        this.container = options.container;
        this.itemHeight = options.itemHeight || 24;
        this.totalItems = options.totalItems || 0;
        this.renderItem = options.renderItem || (() => document.createElement('div'));
        this.bufferSize = options.bufferSize || 5; // 上下缓冲的项数
        
        this.visibleStart = 0;
        this.visibleEnd = 0;
        this.scrollTop = 0;
        this.containerHeight = 0;
        
        this.itemsCache = new Map(); // 缓存已渲染的项
        this.maxCacheSize = 100; // 最大缓存数量
        
        this.init();
    }
    
    init() {
        // 清空容器
        this.container.innerHTML = '';
        
        // 创建内容容器
        this.contentEl = document.createElement('div');
        this.contentEl.style.position = 'absolute';
        this.contentEl.style.top = '0';
        this.contentEl.style.left = '0';
        this.contentEl.style.right = '0';
        this.container.appendChild(this.contentEl);
        
        // 创建占位元素用于撑开滚动条
        this.spacerEl = document.createElement('div');
        this.spacerEl.style.position = 'relative';
        this.spacerEl.style.width = '100%';
        this.spacerEl.style.visibility = 'hidden';
        this.container.appendChild(this.spacerEl);
        
        this.updateSpacerHeight();
    }
    
    updateSpacerHeight() {
        // 设置占位元素高度为总高度
        const totalHeight = this.totalItems * this.itemHeight;
        this.spacerEl.style.height = totalHeight + 'px';
    }
    
    setTotalItems(count) {
        this.totalItems = count;
        this.updateSpacerHeight();
        this.render();
    }
    
    setScrollTop(scrollTop) {
        this.scrollTop = scrollTop;
        this.render();
    }
    
    setContainerHeight(height) {
        this.containerHeight = height;
        this.render();
    }
    
    getVisibleRange() {
        const start = Math.max(0, Math.floor(this.scrollTop / this.itemHeight) - this.bufferSize);
        const visibleCount = Math.ceil(this.containerHeight / this.itemHeight) + this.bufferSize * 2;
        const end = Math.min(this.totalItems - 1, start + visibleCount);
        return { start, end };
    }
    
    render() {
        if (!this.containerHeight) return;
        
        const { start, end } = this.getVisibleRange();
        
        // 清理不再可见的项
        this.cleanupInvisibleItems(start, end);
        
        // 渲染或更新可见范围内的项
        for (let i = start; i <= end; i++) {
            let itemEl = this.itemsCache.get(i);
            
            if (!itemEl) {
                // 创建新元素
                itemEl = this.renderItem(i);
                itemEl.style.position = 'absolute';
                itemEl.style.left = '0';
                itemEl.style.right = '0';
                itemEl.style.height = this.itemHeight + 'px';
                itemEl.dataset.index = i;
                this.contentEl.appendChild(itemEl);
                this.addToCache(i, itemEl);
            }
            
            // 更新元素位置（即使元素已存在，也需要更新位置）
            itemEl.style.top = (i * this.itemHeight) + 'px';
        }
        
        this.visibleStart = start;
        this.visibleEnd = end;
    }
    
    cleanupInvisibleItems(visibleStart, visibleEnd) {
        // 移除不在可见范围内的项
        const toRemove = [];
        for (const [index, element] of this.itemsCache) {
            if (index < visibleStart || index > visibleEnd) {
                toRemove.push(index);
            }
        }
        
        for (const index of toRemove) {
            const element = this.itemsCache.get(index);
            if (element) {
                element.remove();
            }
            this.itemsCache.delete(index);
        }
    }
    
    addToCache(index, element) {
        // 如果缓存已满，删除最早的项
        while (this.itemsCache.size >= this.maxCacheSize) {
            const firstKey = this.itemsCache.keys().next().value;
            const firstEl = this.itemsCache.get(firstKey);
            if (firstEl) {
                firstEl.remove();
            }
            this.itemsCache.delete(firstKey);
        }
        this.itemsCache.set(index, element);
    }
    
    getItemElement(index) {
        return this.itemsCache.get(index);
    }
    
    scrollToItem(index) {
        const scrollTop = index * this.itemHeight;
        this.container.scrollTop = scrollTop;
    }
    
    destroy() {
        this.container.innerHTML = '';
        this.itemsCache.clear();
    }
}

export { VirtualScrollList };
