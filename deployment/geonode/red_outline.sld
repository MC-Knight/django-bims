<?xml version="1.0" encoding="UTF-8"?>
<!--
  Outline of the area picked in the map's spatial filter. The map asks for
  it by name (Site setting "spatial filter layer style", default red_outline),
  so it must exist on every GeoServer the location context groups point at.
  Add it once in GeoServer: Styles > Add a new style, name red_outline,
  no workspace, upload this file, Submit.
-->
<StyledLayerDescriptor version="1.0.0"
    xmlns="http://www.opengis.net/sld"
    xmlns:ogc="http://www.opengis.net/ogc"
    xmlns:xlink="http://www.w3.org/1999/xlink"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>red_outline</Name>
    <UserStyle>
      <Title>Red outline</Title>
      <FeatureTypeStyle>
        <Rule>
          <PolygonSymbolizer>
            <Stroke>
              <CssParameter name="stroke">#FF0000</CssParameter>
              <CssParameter name="stroke-width">2</CssParameter>
            </Stroke>
          </PolygonSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
