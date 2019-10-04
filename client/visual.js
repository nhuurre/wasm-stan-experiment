export
function histogram(svg, data, shape) {
  // shape = {left, right, top, bottom, width, height}
  const x =
    d3.scaleLinear()
      .domain(d3.extent(data))
      .range([shape.left, shape.width - shape.right])
  const bins = 
    d3.histogram()
      .domain(x.domain())
      .thresholds(x.ticks(40))
       (data);
  const y = 
    d3.scaleLinear()
      .domain([0, d3.max(bins, d => d.length)])
      .range([shape.height - shape.bottom, shape.top])
  const bar =
    svg.append('g')
       .attr('fill', 'steelblue')
       .selectAll('rect')
       .data(bins)
       .join('rect')
       .attr('x', d => x(d.x0) + 1)
       .attr('width', d => Math.max(0, x(d.x1) - x(d.x0) - 1))
       .attr('y', d => y(d.length))
       .attr('height', d => y(0) - y(d.length));
  svg.append('g') // xAxis
     .call(g =>
       g.attr('transform', `translate(0,${shape.height - shape.bottom})`)
        .call(d3.axisBottom(x).tickSizeOuter(0))
        .call(g =>
          g.append('text')
           .attr('x', shape.width - shape.right)
           .attr('y', -4)
           .attr('fill', '#000')
           .attr('font-weight', 'bold')
           .attr('text-anchor', 'end')
           .text(data.x)
        )
     );
  svg.append('g') // yAxis
     .call(g =>
       g.attr('transform', `translate(${shape.left},0)`)
        .call(d3.axisLeft(y))
        .call(g =>
          g.select('.tick:last-of-type text').clone()
           .attr('x', 4)
           .attr('text-anchor', 'start')
           .attr('font-weight', 'bold')
           .text(data.y)
        )
     );
}
